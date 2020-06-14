import {
    VariableNode,
    IntValueNode,
    FloatValueNode,
    StringValueNode,
    BooleanValueNode,
    NullValueNode,
    EnumValueNode,
    ListValueNode,
    ObjectValueNode,
    ValueNode,
    FieldNode,
    SelectionSetNode,
    GraphQLResolveInfo,
    OperationTypeNode,
} from "graphql"
import { isString } from "./util"

type NodesToValues =
    | [VariableNode, any]
    | [IntValueNode, number]
    | [FloatValueNode, number]
    | [StringValueNode, string]
    | [BooleanValueNode, boolean]
    | [NullValueNode, null]
    | [EnumValueNode, string]
    | [ListValueNode, any[]]
    | [ObjectValueNode, { [key: string]: any }]

/**
 * Parse a value's AST form into a JavaScript value.
 * @param n The ValueNode.
 * @param info Any valid GraphQLResolveInfo in this query, (for use in accessing variable values)
 * @return The JavaScript value of the ValueNode.
 */
export const parseValueNode = <T extends NodesToValues>(
    n: T[0],
    info: GraphQLResolveInfo
): T[1] => {
    const node = n as ValueNode
    switch (node.kind) {
        case "IntValue":
            return parseInt(node.value)
        case "FloatValue":
            return parseFloat(node.value)
        case "StringValue":
            return node.value
        case "BooleanValue":
            return node.value
        case "NullValue":
            return null
        case "EnumValue":
            return node.value
        case "ListValue":
            return node.values.map(v => parseValueNode(v, info))
        case "ObjectValue":
            return node.fields
                .map(({ name, value }) => ({ [name.value]: parseValueNode(value, info) }))
                .reduce((a, x) => ({ ...a, ...x }), {})
        case "Variable":
            return info.variableValues[node.name.value]
        default:
            return null
    }
}

export interface PolymorphicFields {
    getFields(type?: string): Map<string, FieldNode>
    hasFields(type?: string): boolean
}

/**
 * Without knowing what the concrete type of the FieldNode's value is, creates a way to
 * access all possible FieldNodes given any possible concrete type.
 * @param n The parent FieldNode
 * @param info Any valid GraphQLResolveInfo in this query, as fragments may be required.
 * @returns An interface for telling whether a specific type has any fields requests in this query, and returns them as appropriate.
 */
export const getSubfields = (n: FieldNode, info: GraphQLResolveInfo): PolymorphicFields => {
    const all = new Map<string, FieldNode>()
    const polymorphic = new Map<string, Map<string, FieldNode>>()

    const copy = (to: string, from?: string) => {
        let toMap: Map<string, FieldNode>
        if (!polymorphic.has(to)) {
            toMap = new Map()
            polymorphic.set(to, toMap)
        } else toMap = polymorphic.get(to)!

        let fromMap = !isString(from) ? all : polymorphic.get(from)!

        for (const [k, v] of fromMap) toMap.set(k, v)
    }

    const parseSelectionSet = (s: SelectionSetNode | undefined, resolvedType?: string) => {
        const add = isString(resolvedType)
            ? (s: string, v: FieldNode) => {
                  if (!polymorphic.has(resolvedType)) polymorphic.set(resolvedType, new Map())
                  polymorphic.get(resolvedType)!.set(s, v)
              }
            : all.set.bind(all)

        if (s) {
            for (const selection of s.selections) {
                if (selection.kind === "Field") {
                    add(selection.name.value, selection)
                } else if (selection.kind === "FragmentSpread") {
                    const fragment = info.fragments[selection.name.value]
                    if (!fragment) continue
                    const typeName = fragment.typeCondition.name.value ?? resolvedType
                    copy(typeName, resolvedType)
                    parseSelectionSet(fragment.selectionSet, typeName)
                } else {
                    const typeName = selection.typeCondition?.name?.value ?? resolvedType
                    if (isString(typeName)) copy(typeName, resolvedType)
                    parseSelectionSet(selection.selectionSet, typeName)
                }
            }
        }
    }

    parseSelectionSet(n.selectionSet)

    return {
        getFields(type?: string) {
            if (isString(type)) return new Map([...(polymorphic.get(type) ?? [])])
            return new Map(all)
        },
        hasFields(type?: string) {
            if (isString(type)) return polymorphic.has(type) && polymorphic.get(type)!.size > 0
            else return all.size > 0
        },
    }
}

/**
 * Derive the operation type of the given query.
 * @param o The GraphQLResolveInfo of the query.
 * @returns The operation type - `query`, `mutation`, or `subscription`.
 */
export const getOperation = (o: GraphQLResolveInfo): OperationTypeNode => o.operation.operation
