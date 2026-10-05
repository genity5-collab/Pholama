// Turns the Deno function source into plain JavaScript for tests: removes the type annotations the function uses.
module.exports = function stripTs(code) {
  return code
    .replace(/\(k\): k is string =>/g, '(k) =>')
    .replace(/^(const \w+): [^=\n]+=/gm, '$1 =')                                   // const X: Type[] =
    .replace(/(\bfunction \w+)\(([^)]*)\)\s*:\s*Promise<[^{]+>\s*\{/g, (m, f, a) => f + '(' + a.replace(/:\s*\{[^}]*\}(\[\])?/g, '').replace(/:\s*[\w<>\[\]| ]+/g, '') + ') {')
    .replace(/(\bfunction \w+)\(([^)]*)\)\s*\{/g, (m, f, a) => f + '(' + a.replace(/:\s*\{[^}]*\}(\[\])?/g, '').replace(/:\s*[\w<>\[\]| ]+/g, '') + ') {')
    .replace(/\b(const|let) (\w+): \{[^=]*\}\[\] =/g, '$1 $2 =')                    // const prompt: {..}[] =
    .replace(/ as any/g, '').replace(/\(k: string\)/g, '(k)').replace(/\(j: any\)/g, '(j)').replace(/: Promise<any>/g, '').replace(/: any/g, '');
};
