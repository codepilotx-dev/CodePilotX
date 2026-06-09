import type React from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './routes.js'

export function App(): React.ReactNode {
  return <RouterProvider router={router} />
}
