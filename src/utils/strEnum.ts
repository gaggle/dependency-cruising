/**
 * Utility function to create a K:V from a list of strings
 *
 * https://basarat.gitbook.io/typescript/type-system/literal-types#string-based-enums
 */
export function strEnum<T extends string> (o: Array<T>): { [K in T]: K } {
  return o.reduce((res, key) => {
    res[key] = key
    return res
  }, Object.create(null))
}
