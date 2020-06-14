import { GraphQLResolveInfo, FieldNode, GraphQLObjectType } from "graphql"
import { getSubfields, parseValueNode } from "./ast"

/**
 * Given the GraphQLResolveInfo of a parent field, (and all necessary surrounding information),
 * derive the args and info parameters for the subscribe resolver in all current fields.
 * @param type The concrete type of the current field's value
 * @param info The parent field's GraphQLResolveInfo
 * @param arrayKeys If the parent field is an array, (or a multidimensional array), this is the number-path to the current field.
 * @returns A map of keys to their resolver args and GraphQLResolveInfos.
 */
export const descendFields = <TArgs extends Record<string, any>>(
    type: GraphQLObjectType,
    info: GraphQLResolveInfo,
    arrayKeys: number[] = []
): Map<
    string,
    {
        info: GraphQLResolveInfo
        args: TArgs
    }
> => {
    const fieldNode = info.fieldNodes.find(n => n.name.value === info.fieldName)
    if (!fieldNode) throw "The field does not exist, incoming GraphQLResolveInfo is corrupt."

    const { getFields, hasFields } = getSubfields(fieldNode, info)
    // This expects all rest operators to be over concrete types.
    // TODO: expand this to all types, i.e. + interfaces and unions
    let fieldNodes: FieldNode[] = [
        ...(hasFields(type.name) ? getFields(type.name).values() : getFields().values()),
    ]

    let basePath = arrayKeys.reduce((prev, key) => ({ prev, key }), info.path)

    return new Map(
        fieldNodes.map(node => {
            const fieldName = node.name.value
            const args = (node.arguments ?? [])
                .map(({ name, value }) => ({ [name.value]: parseValueNode(value, info) }))
                .reduce((a, x) => ({ ...a, ...x }), {}) as TArgs
            const returnField = type.getFields()[fieldName]
            if (!returnField) throw `Field ${fieldName} does not exist on type.`
            const returnType = returnField.type

            const newInfo = {
                ...info,
                fieldName,
                fieldNodes,
                parentType: type,
                returnType,
                path: { prev: basePath, key: fieldName },
            }

            return [
                fieldName,
                {
                    info: newInfo,
                    args,
                },
            ]
        })
    )
}
