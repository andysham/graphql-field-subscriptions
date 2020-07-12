import { patchFieldSubscriptions } from "../../index"

const wait = (t: number) => new Promise(res => setTimeout(res, t))

export const resolverMap = {
    Subscription: {
        root: {
            resolve: () => ({}),
            subscribe: () =>
                (async function* () {
                    yield { root: {} }
                })(),
        },
    },
    Root: {
        node1: () => ({ leaf: "hey" }),
        node2: {
            subscribe: () =>
                async function* () {
                    let count = 0
                    while (true) {
                        yield { node2: { leaf: `ho${count}` } }
                        await wait(1000)
                    }
                },
        },
    },
    Node: {},
    Query: {},
}

export const resolvers = patchFieldSubscriptions(resolverMap)
