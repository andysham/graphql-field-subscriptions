import { IResolvers, IFieldResolver, IObjectTypeResolver } from "graphql-tools"
import { FieldNode, GraphQLInputObjectType, isLeafType, isObjectType } from "graphql"
import { getOperation } from "./ast"
import { resolveType, GraphQLConcreteType } from "./type"
import { descendFields } from "./args"
import {
    predictAsyncIterator,
    mergeAsyncIterators,
    toAsyncIterableIterator,
    mapAsyncIterator,
    cutAsyncIterator,
    toAsync,
    cleanGraphQLSubscriptionFormat,
    isArray,
} from "./util"

// Can't get a proper import for some reason, this is a hack
type IFieldResolverOptions = Exclude<
    IObjectTypeResolver[keyof IObjectTypeResolver],
    IFieldResolver<any, any>
>

/**
 * Given a native resolver map, add field subscription functionality.
 * @param resolverMap The native resolver map.
 * @returns An equivalent resolver map, that allows child subscriptions to update their parents.
 */
export const patchResolverMap = (resolverMap: IResolvers<any, any>): IResolvers<any, any> => {
    const types: IResolvers = {}
    for (const type of Object.keys(resolverMap)) {
        const fields: IResolvers[keyof IResolvers] = {}

        for (const field of Object.keys(resolverMap[type])) {
            if (field.startsWith("__")) {
                // @ts-ignore
                fields[field] = resolverMap[type][field]
                continue
            }
            // @ts-ignore
            const resolver = resolverMap[type][
                field
            ] as IObjectTypeResolver[keyof IObjectTypeResolver]
            const newResolver: IFieldResolverOptions =
                resolver instanceof Function
                    ? { resolve: resolver as IFieldResolver<any, any> }
                    : resolver

            // @ts-ignore
            fields[field] = patchResolver(newResolver)
        }

        types[type] = fields
    }
    return types
}

/**
 * Patches a specific type resolver with the field subscription functionality.
 * @param o The resolver options.
 * @returns Patched resolver options.
 */
export const patchResolver = (o: IFieldResolverOptions): IFieldResolverOptions => {
    const resolve: IFieldResolver<any, any> = (parent, args, ctx, info) => {
        const op = getOperation(info)
        if (op === "subscription" && "subscribe" in o) return parent[info.fieldName]
        else return o.resolve!(parent, args, ctx, info)
    }

    const subscribe: IFieldResolver<any, any> = (parent, args, ctx, info) => {
        const r = mapAsyncIterator(
            (async function* () {
                for await (const [value, { awaitNext }] of predictAsyncIterator(
                    cleanGraphQLSubscriptionFormat(
                        await toAsync(o.subscribe!(parent, args, ctx, info)),
                        info.fieldName
                    )
                )) {
                    type ConcreteType = Exclude<GraphQLConcreteType, GraphQLInputObjectType>

                    const iterateValue = async function* (
                        value: any,
                        concreteType: ConcreteType,
                        arrayPath: number[] = []
                    ) {
                        if (concreteType === null) {
                            yield null
                            return
                        } else if (isLeafType(concreteType)) {
                            yield value
                            return
                        } else if (isObjectType(concreteType)) {
                            const fieldArgs = descendFields(concreteType, info, [])
                            const fieldIterators = [] as AsyncIterableIterator<[string, any]>[]
                            const fieldResolvers = concreteType.getFields()

                            // create iterators for all subfields
                            for (const [field, { args, info }] of fieldArgs) {
                                if (!(field in fieldResolvers))
                                    throw `${field} not a field of ${concreteType.name}, cannot resolve.`
                                const it = mapAsyncIterator(
                                    (async function* () {
                                        const resolver = fieldResolvers[field]
                                        if ("subscribe" in resolver) {
                                            yield* cleanGraphQLSubscriptionFormat(
                                                await toAsync(
                                                    resolver.subscribe!(value, args, ctx, info)
                                                ),
                                                field
                                            )
                                        } else if ("resolve" in resolver) {
                                            yield* cleanGraphQLSubscriptionFormat(
                                                await toAsync(
                                                    resolver.resolve!(value, args, ctx, info)
                                                ),
                                                field
                                            )
                                        } else yield value[field] ?? null
                                    })(),
                                    v => [field, v] as [string, any]
                                )
                                fieldIterators.push(it)
                            }

                            const empty = Symbol("empty")
                            const currValue = [...fieldArgs.keys()].reduce(
                                (a, x) => ({ ...a, [x]: empty }),
                                {} as {
                                    [key: string]: any
                                }
                            )
                            let hasAllFields = false

                            // update value based on all subfields
                            for await (const [field, value] of cutAsyncIterator(
                                mergeAsyncIterators(...fieldIterators),
                                awaitNext()
                            )) {
                                currValue[field] = value
                                if (!hasAllFields) {
                                    hasAllFields = [...fieldArgs.keys()].every(
                                        key => key in currValue && currValue[key] !== empty
                                    )
                                }
                                if (hasAllFields) yield currValue
                            }

                            return
                        } else if (isArray(concreteType)) {
                            const iterators = [] as AsyncIterableIterator<[number, any]>[]
                            for (const [i, type] of concreteType.entries()) {
                                iterators[i] = iterateValue(value[i], type as ConcreteType, [
                                    ...arrayPath,
                                    i,
                                ])
                            }

                            const empty = Symbol("empty")
                            const currValue = [...concreteType.keys()].map(() => empty) as any[]
                            let hasAllFields = false

                            // update value based on all subfields
                            for await (const [field, value] of cutAsyncIterator(
                                mergeAsyncIterators(...iterators),
                                awaitNext()
                            )) {
                                currValue[field] = value
                                if (!hasAllFields) {
                                    hasAllFields = currValue.every(value => value !== empty)
                                }
                                if (hasAllFields) yield currValue
                            }
                            return
                        }

                        yield null
                    }

                    const type = info.returnType
                    const concreteType = (await resolveType(value, ctx, info, type)) as ConcreteType

                    yield* iterateValue(value, concreteType, [])
                }
            })(),
            (x: any) => ({ [info.fieldName]: x })
        )
        return (async function* () {
            for await (const v of r) {
                yield v
            }
        })()
    }

    return {
        ...o,
        ...("resolve" in o ? { resolve } : {}),
        ...("subscribe" in o ? { subscribe } : {}),
    }
}