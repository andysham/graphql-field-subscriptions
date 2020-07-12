import express from "express"
import { ApolloServer } from "apollo-server-express"
import * as http from "http"
import cors from "cors"
import { typeDefs } from "./schema"
import { resolvers } from "./resolvers"

const PORT = 5555

const init = async () => {
    try {
        console.log(`Starting GraphQL subscriptions server on port ${PORT}.`)

        var app = express()
        app.use(cors())

        app.use(express.json())
        app.use(express.urlencoded({ extended: true }))
        app.use(express.raw({ type: "*/*" }))

        app.use("/graphql", express.text())
        app.use("/graphql", (req, res, next) => {
            if (typeof req.body === "string") req.body = JSON.parse(req.body)
            next()
        })

        //@ts-ignore
        const apolloServer = new ApolloServer({ typeDefs, resolvers })
        apolloServer.applyMiddleware({ app })

        const httpServer = http.createServer(app)
        apolloServer.installSubscriptionHandlers(httpServer)

        httpServer.listen(PORT, () => {
            console.log(`Server listening on port ${PORT}.`)
        })
    } catch (err) {
        console.log(`Uncaught exception - ${err}`)
    }
}

init()
