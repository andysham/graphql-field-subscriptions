import { PromiseOrValue } from "graphql/jsutils/PromiseOrValue"
import { EventEmitter } from "events"

export const isArray = (x: any): x is any[] => x instanceof Array
export const isString = (x: any): x is string => typeof x === "string"
export const isObject = (x: any): x is object => x && typeof x === "object"

/**
 * Returns a promise which never resolves.
 */
export const neverResolve = () => new Promise(() => {})

/**
 * There are plenty of instances where a function may return a value, or return a promise,
 * in which GraphQL.js will wait for the promise to return a value before using it.
 * This makes handling such instances consistent.
 */
export const toAsync = async <T>(v: PromiseOrValue<T>): Promise<T> => {
    if (v instanceof Promise) return await v
    else return v
}

/**
 * Convert value to naturally associated asyncIterator
 */
export const asyncIterateOnce = async function* <T>(v: T): AsyncIterator<T> {
    yield v
}

/**
 * Convert value to naturally associated asyncIterator, which in this case never resolves once the value is returned.
 */
export const asyncIterateOnceAndWait = async function* <T>(v: T): AsyncIterator<T> {
    yield v
    await neverResolve()
}

/**
 * Checks whether the interface given by the input matches that of an AsyncIterable.
 * As AsyncIterables are not concrete types, this may return false values.
 */
export const isAsyncIterable = (v: any): boolean => {
    //@ts-ignore
    return isObject(v) && Symbol.asyncIterator in v && typeof v[Symbol.asyncIterator] === "function"
}
/**
 * Checks whether the interface given by the input matches that of an AsyncIterable.
 * As AsyncIterators are not concrete types, this may return false values.
 */
export const isAsyncIterator = (v: any): boolean => {
    //@ts-ignore
    return isObject(v) && "next" in v && typeof v.next === "function"
}
/**
 * Checks whether the interface given by the input matches that of an AsyncIterable.
 * As AsyncIterableIterators are not concrete types, this may return false values.
 */
export const isAsyncIterableIterator = (v: any): boolean => isAsyncIterable(v) && isAsyncIterator(v)

/**
 * If not an async iterable, convert it into one.
 */
export const toAsyncIterable = <T>(v: T | AsyncIterable<T>): AsyncIterable<T> => {
    // @ts-ignore
    if (isAsyncIterable(v)) {
        return v as AsyncIterable<T>
    } else {
        return { [Symbol.asyncIterator]: () => asyncIterateOnceAndWait(v as T) }
    }
}
/**
 * If not an async iterator, convert it into one.
 */
export const toAsyncIterator = <T>(v: T | AsyncIterator<T>): AsyncIterator<T> => {
    // @ts-ignore
    if (isAsyncIterator(v)) {
        return v as AsyncIterator<T>
    } else {
        return asyncIterateOnceAndWait(v as T)
    }
}

/**
 * If not an async iterable iterator, convert it into one.
 */
export const toAsyncIterableIterator = <T>(v: T | AsyncIterator<T>): AsyncIterableIterator<T> => {
    const preIt = toAsyncIterator(v)
    const it: AsyncIterableIterator<T> = {
        async next(...args) {
            return preIt.next(...args)
        },
        ...("return" in preIt
            ? {
                  async return(...args) {
                      return preIt.return!(...args)
                  },
              }
            : {}),
        ...("throw" in preIt
            ? {
                  async return(...args) {
                      return preIt.throw!(...args)
                  },
              }
            : {}),
        [Symbol.asyncIterator]: () => it,
    }
    return it
}

interface AsyncIteratorPromise {
    hasNext: boolean
    onNext: (f: () => void) => void
    awaitNext: () => Promise<void>
}

/**
 * Async iterables only iterate further when both the body of the 'for await' loop has halted, and
 * there is a new iterator result.
 *
 * This allows you, within the body of the loop, to tell whether there is a new iterator result, and
 * break the loop if needed.
 *
 * @param it The async iterator
 * @returns The same iterator, as well as an interface for gaining information on future iterator results.
 * `hasNext` a boolean which is true if there is a new result.
 * `onNext` an event emitter which runs functions once, when there is a new result, or immediately if the result
 * has already been recieved.
 * `awaitNext` returns a promise that resolves when there is a new result, or immediately if the result has
 * already been recieved.
 */
export const predictAsyncIterator = async function* <T>(
    it: AsyncIterableIterator<T>
): AsyncIterableIterator<[T, AsyncIteratorPromise]> {
    const fs = new Map<T, (() => void)[]>()
    let onNext = () => {}
    for await (const v of it) {
        onNext()
        fs.set(v, [])
        let o: Partial<AsyncIteratorPromise> = { hasNext: false }
        o.onNext = f => {
            if (o.hasNext) f()
            else fs.get(v)!.push(f)
        }
        o.awaitNext = () => {
            return new Promise(o.onNext!)
        }
        onNext = () => {
            o.hasNext = true
            const handlers = fs.get(v) ?? []
            fs.delete(v)
            Promise.all(handlers.map(async h => h()))
        }
        yield [v, o as AsyncIteratorPromise]
    }
}

/**
 * Returns a new async iterator, with each result mapped.
 * @param it The original iterator.
 * @param map The mapping function.
 * @returns The mapped iterator.
 */
export const mapAsyncIterator = async function* <T, U>(
    it: AsyncIterableIterator<T>,
    map: (v: T) => U
): AsyncIterableIterator<U> {
    for await (const v of it) {
        yield map(v)
    }
}

/**
 * Given multiple async iterators, returns a new iterator that returns a result when any of the
 * original iterators returns a result.
 * @param its The original iterators.
 * @return The merged iterator.
 */
export const mergeAsyncIterators = <T>(
    ...its: AsyncIterableIterator<T>[]
): AsyncIterableIterator<T> => {
    const h = new EventEmitter()
    const newValue = Symbol("newValue")
    const queue = [] as T[]
    let finished = false

    Promise.all(
        its.map(async it => {
            for await (const v of it) {
                queue.push(v)
                h.emit(newValue)
            }
        })
    ).then(() => {
        finished = true
    })

    return toAsyncIterableIterator({
        async next() {
            if (finished && queue.length === 1)
                return Promise.resolve({ value: queue[0], done: true })
            if (!finished && queue.length === 0)
                await new Promise(res => {
                    h.once(newValue, res)
                })

            const value = queue.splice(0, 1)[0]
            return Promise.resolve({ value, done: false })
        },
    })
}

/**
 * Given a promise, return an async iterator which waits for the promise to resolve, and return
 * the promise result as an iterator result.
 */
export const promiseToAsyncIterator = async function* <T>(
    promise: Promise<T>
): AsyncIterableIterator<T> {
    yield await promise
}

/**
 * Given an async iterator, and a promise, allow the iterator to return values until the promise
 * resolves, in which case the iterator terminates.
 */
export const cutAsyncIterator = async function* <T>(
    it: AsyncIterableIterator<T>,
    cut: Promise<any>
): AsyncIterableIterator<T> {
    for await (const v of mergeAsyncIterators<{ value: T } | false>(
        mapAsyncIterator(it, value => ({ value })),
        mapAsyncIterator(promiseToAsyncIterator(cut), () => false)
    )) {
        if (v === false) return
        else yield v.value
    }
}

/**
 * GraphQL.js requires subscription async iterators to return values in the format of
 * `{ [fieldName]: value }`, unlike resolve functions, which only require `value` directly.
 *
 * Subscriptions may return both async iterators and raw values. If it returns an async iterator,
 * it maps `{ [fieldName]: value }` results to just `value`.
 *
 * If it returns a raw value, it converts it into an async iterator.
 * @param v The return value of the subscription resolver.
 * @param fieldName The name of the field the resolver belongs to.
 */
export const cleanGraphQLSubscriptionFormat = (
    v: any,
    fieldName: string
): AsyncIterableIterator<any> =>
    isAsyncIterableIterator(v)
        ? mapAsyncIterator(v as AsyncIterableIterator<any>, o => o[fieldName])
        : toAsyncIterableIterator(v)
