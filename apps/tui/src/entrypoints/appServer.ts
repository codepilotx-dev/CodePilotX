import { createStdioJsonRpcAppServer } from '../appServer/stdio.js'

const connection = createStdioJsonRpcAppServer()
connection.listen()
