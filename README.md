# graphql-field-subscriptions

This library allows GraphQL.js servers to treat subscriptions much like queries, in that one can make successive subscriptions through the schema's graph, much like multiple query resolves can be made in succession.

# Installation

For npm users,

```
$ npm install graphql-field-subscriptions
```

For yarn users,

```
$ yarn add graphql-field-subscriptions
```

This library supports TypeScript by default, as God intended

# The problem (in detail)

Given a resolver map like so,

```javascript
const schema = gql`
    type Query {
        hello: Hello!
    }

    type Hello {
        world: String!
    }
`

const resolverMap = {
    Query: {
        hello: () => ({}),
    },
    Hello: {
        world: () => "Hello World!",
    },
}
```

The nature of GraphQL allows us to make a query like so,

```graphql
{
    hello {
        world
    }
}
```

And recieve the result,

```json
{
    "data": {
        "hello": {
            "world": "Hello World!"
        }
    }
}
```

However, the same is not true for subscriptions. If we now have a schema and resolver map like so,

```javascript
const schema = gql`
    type Subscription {
        hello: Hello!
    }

    type Hello {
        world: String!
    }
`

const resolverMap = {
    Subscription: {
        hello: {
            subscribe: () => toAsyncIterator({ hello: {} }),
        },
    },
    Hello: {
        world: {
            subscribe: () => toAsyncIterator({ world: "Hello World!" }),
        },
    },
}

const toAsyncIterator = x =>
    async function* () {
        yield x
    }
```

And query the server accordingly,

```graphql
subscription {
    hello {
        world
    }
}
```

Then we recieve an error, like so,

```json
{
    "error": {
        "name": "FormatedError",
        "message": "Unknown error",
        "originalError": "Cannot return null value for non-null type."
    }
}
```

Which is odd, as we haven't returned null anywhere. On further inspection, if we make a small change:

```javascript
const resolverMap = {
    ...
    Hello: {
        world: {
            resolve: () => 'Hello World!', // new line here
            subscribe: () => toAsyncIterator({ world: 'Hello World!' })
        }
    }
}
```

Then we get the return value as desired. However, what if we wanted the value of `hello.world` to change over time? GraphQL.js currently does not allow for this, only allowing subscriptions at the top level of the `Subscription` query. This certainly isn't in the spirit of GraphQL.

# The solution

This library supplies a single function, `patchFieldSubscriptions`, which allows for this functionality. If we do the following,

```javascript
import { patchFieldSubscriptions } from 'graphql-field-subscriptions'

...

const resolverMap = patchFieldSubscriptions({
    Subscription: {
        hello: {
            subscribe: () => toAsyncIterator({ hello: {} })
        }
    },
    Hello: {
        world: {
            resolve: () => 'A different string, to show that this works',
            subscribe: () => toAsyncIterator({ world: 'Hello World!' })
        }
    }
})

...
```

We now get the following result,

```json
{
    "data": {
        "hello": {
            "world": "Hello World!"
        }
    }
}
```

Not only this, but the value of `world`, as well as any values at a further depth, can mutate over time.

```javascript
...

const resolverMap = patchFieldSubscriptions({
    ...
    Hello: {
        world: {
            subscribe: () => (async function* () {
                while (true) {
                    yield `Here's a cool number: ${Math.random()}`
                    await wait(5000) // this function hangs the thread for 5 seconds
                }
            })
        }
    }
})

...
```

```json
{
    "data": {
        "hello": {
            "world": "Here's a cool number: 0.8345525102611744"
        }
    }
}
...

{
    "data": {
        "hello": {
            "world": "Here's a cool number: 0.6994837333822601"
        }
    }
}
...

{
    "data": {
        "hello": {
            "world": "Here's a cool number: 0.22817198786140014"
        }
    }
}
```
