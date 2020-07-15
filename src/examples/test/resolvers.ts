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
    NodeBuffer: {
        node: {
            subscribe: () => {

                return (async function* () {
                    let count = 0
                    while (true) {
                        yield { node: { leaf: `ho${count}` } }
                        count++
                        await wait(1000)
                    }
                })()
            }
        }
    },
    Root: {
        node1: {
            resolve: function() {    
                return ({ leaf: "brim bram" }) 
            },
        },
        node2: {
            subscribe: () => {

                return (async function* () {
                    let count = 0
                    while (true) {
                        yield { node2: { leaf: `ho${count}` } }
                        count++
                        await wait(1000)
                    }
                })()
            }
        },
        nodebuffer: () => ({}),
        nodes: {
            subscribe: () => {

                return (async function* () {
                    let count = 0
                    while (true) {
                        yield { nodes: [0,1,2,3].map(i => ({ leaf: `${i}-${count}` })) }
                        count++
                        await wait(1000)
                    }
                })()

            }
        }
    },
    Node: {},
    Query: {
        ping: () => 'pong'
    },
}

export const resolvers = patchFieldSubscriptions(resolverMap)
