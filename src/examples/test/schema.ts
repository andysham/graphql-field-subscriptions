import { gql } from "apollo-server-express"

export const typeDefs = gql`
    type Subscription {
        root: Root!
    }

    type Root {
        node1: Node!
        node2: Node!
    }

    type Node {
        leaf: String!
    }

    type Query {
        root: Root!
    }
`
