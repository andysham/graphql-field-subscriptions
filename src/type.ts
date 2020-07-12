import {
    GraphQLInterfaceType,
    GraphQLOutputType,
    isLeafType,
    isCompositeType,
    isAbstractType,
    assertWrappingType,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLType,
    isType,
    GraphQLInputObjectType,
    GraphQLUnionType,
    GraphQLList,
    GraphQLScalarType,
    GraphQLEnumType,
    GraphQLResolveInfo,
    GraphQLNullableType,
} from "graphql"
import { toAsync, isArray, isString } from "./util"

/**
 * An type structure which allows a GraphQL.js type to easily be deduced.
 */
type TypeStructure =
    | {
          type: "scalar" | "object" | "input-object" | "interface"
      }
    | {
          type: "union"
          subtypes: TypeStructure[]
      }
    | {
          type: "enum"
          subtypes: string[]
      }
    | {
          type: "list" | "non-null"
          subtype: TypeStructure
      }

const isXType = (x: string) => (t: any): boolean => {
    if (!isType(t)) return false
    return getTypeStructure(t).type === x
}
export const isScalarType = isXType("scalar") as (t: any) => t is GraphQLScalarType
export const isObjectType = isXType("object") as (t: any) => t is GraphQLObjectType
export const isInputObjectType = isXType("input-object") as (t: any) => t is GraphQLInputObjectType
export const isInterfaceType = isXType("interface") as (t: any) => t is GraphQLInterfaceType
export const isUnionType = isXType("union") as (t: any) => t is GraphQLUnionType
export const isEnumType = isXType("enum") as (t: any) => t is GraphQLEnumType
export const isListType = isXType("list") as (t: any) => t is GraphQLList<any>
export const isNonNullType = isXType("non-null") as (t: any) => t is GraphQLNonNull<any>
export const isNullableType = (t: any): boolean => !isXType("non-null")(t)

/**
 * Any GraphQL.js type which may (potentially) have subfields.
 */
export type GraphQLFieldType =
    | GraphQLObjectType
    | GraphQLInputObjectType
    | GraphQLInterfaceType
    | GraphQLUnionType
    | GraphQLList<GraphQLFieldType>
    | GraphQLNonNull<GraphQLFieldType>

/**
 * Is the input a GraphQL.js type which may have subfields.
 * @param x The input
 */
export const isFieldType = (x: any): x is GraphQLFieldType => {
    if (!isType(x)) return false

    const isFieldTypeStr = (s: TypeStructure): boolean => {
        switch (s.type) {
            case "object":
                return true
            case "input-object":
                return true
            case "interface":
                return true
            case "union":
                return s.subtypes.findIndex(isFieldTypeStr) !== -1
            case "non-null":
                return isFieldTypeStr(s.subtype)
            case "list":
                return isFieldTypeStr(s.subtype)
        }
        return false
    }

    return isFieldTypeStr(getTypeStructure(x))
}

/**
 * Given a GraphQL.js type, compare interfaces between types to deduce what the type structure is.
 * @param type The input type.
 * @returns A data object which more intuitively shows the structure of the GraphQL.js type.
 */
export const getTypeStructure = (type: GraphQLType): TypeStructure => {
    if (isLeafType(type)) {
        if ("getValues" in type) {
            return {
                type: "enum",
                subtypes: type.getValues().map(v => v.name),
            }
        } else {
            return {
                type: "scalar",
            }
        }
    } else if (isCompositeType(type)) {
        if (isAbstractType(type)) {
            if ("getFields" in type) {
                return {
                    type: "interface",
                }
            } else {
                return {
                    type: "union",
                    subtypes: type.getTypes().map(t => getTypeStructure(t)),
                }
            }
        } else {
            return {
                type: "object",
            }
        }
    } else if ("getFields" in type) {
        return {
            type: "input-object",
        }
    } else {
        assertWrappingType(type)
        if (type instanceof GraphQLNonNull) {
            return {
                type: "non-null",
                subtype: getTypeStructure(type.ofType as GraphQLOutputType),
            }
        } else {
            return {
                type: "list",
                subtype: getTypeStructure(type.ofType as GraphQLOutputType),
            }
        }
    }
}

/**
 * Given an abstract GraphQL.js type, and a value, we can resolve it into any of the
 * following types.
 */
export type GraphQLConcreteType =
    | GraphQLScalarType
    | GraphQLObjectType
    | GraphQLInputObjectType
    | GraphQLEnumType
    | GraphQLConcreteType[]
    | null

/**
 * Resolve a value into a concrete GraphQL.js type given an abstract type, and necessary info.
 * @param value The incoming value
 * @param context The GraphQL.js context object
 * @param info Any GraphQLResolveInfo relevant to this query.
 * @param type The abstract type of the value given.
 * @returns The concrete type of the value given.
 */
export const resolveType = async (
    value: any,
    context: any,
    info: GraphQLResolveInfo,
    type: GraphQLType
): Promise<GraphQLConcreteType> => {
    if (isNonNullType(type)) {
        if (value == null) throw "Cannot return null value for non-null type."
        const subtype = type.ofType as GraphQLNullableType
        return await resolveType(value, context, info, subtype)
    } else {
        if (value == null) return null
        else if (isAbstractType(type)) {
            if (!type.resolveType)
                throw "No type resolver. Cannot subscribe to field with no concrete type."
            const v = await toAsync(type.resolveType(value, context, info, type))
            if (!v) throw "No type resolved. Cannot subscribe to field with no concrete type."
            const t = isString(v) ? info.schema.getType(v) : v
            if (!t)
                throw `Type ${v} does not exist. Cannot subscribe to field with no concrete type.`
            return await resolveType(value, context, info, t)
        } else if (isListType(type)) {
            if (!isArray(value)) throw "Value is not an array. Cannot resolve further types."
            const subtype = type.ofType as GraphQLType
            return await Promise.all(value.map(v => resolveType(v, context, info, subtype)))
        } else return type
    }
}
