import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-jsonrpc/node'
import { JsonRpcAppServer } from './server.js'
import { THREAD_EVENT_NOTIFICATION } from './protocol.js'

export function registerJsonRpcAppServer(
  connection: MessageConnection,
  server = new JsonRpcAppServer(undefined, {
    onThreadEvent: event =>
      connection.sendNotification(THREAD_EVENT_NOTIFICATION, { event }),
  }),
): void {
  connection.onRequest('initialize', () => server.initialize())
  connection.onRequest('thread/start', params => server.startThread(params as never))
  connection.onRequest('thread/resume', params => server.resumeThread(params as never))
  connection.onRequest('thread/fork', params => server.forkThread(params as never))
  connection.onRequest('turn/start', params => server.startTurn(params as never))
  connection.onRequest('turn/interrupt', params =>
    server.interruptTurn(params as never),
  )
  connection.onRequest('turn/rollback', params =>
    server.rollbackTurn(params as never),
  )
  connection.onRequest('item/inject', params => server.injectItem(params as never))
  connection.onRequest('session/getSnapshot', params =>
    server.getSessionSnapshot(params as never),
  )
}

export function createStdioJsonRpcAppServer(): MessageConnection {
  const connection = createMessageConnection(
    new StreamMessageReader(process.stdin),
    new StreamMessageWriter(process.stdout),
  )
  registerJsonRpcAppServer(connection)
  return connection
}
