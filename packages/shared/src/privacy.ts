/**
 * O que o Sentry pode coletar: nada além do erro em si (sigilo do livro, T.03).
 * Corpo de requisição, cabeçalhos, cookies, parâmetros e variáveis de pilha
 * podem conter trechos do manuscrito ou tokens, então ficam todos desligados.
 */
export function sentryDataCollection() {
  return {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    mcp: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  }
}
