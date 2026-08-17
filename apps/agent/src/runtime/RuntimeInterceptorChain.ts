import { AgentError } from "../domain"
import type { RuntimeInterceptor, RuntimeInterceptorPoint, RuntimeInterceptorRegistration } from "./RuntimeContribution"

/**
 * 按 composition 顺序执行 scoped interceptor chain。
 *
 * - next(value) 最多调用一次；重复调用是安全错误。
 * - 不调用 next() 表示明确 short-circuit，interceptor 必须返回 reject/pause/handled
 *   语义结果（由调用方解释）。
 * - interceptor 抛错视为 reject，向调用方传播安全错误。
 */
export class RuntimeInterceptorChain {
  private readonly byPoint = new Map<RuntimeInterceptorPoint, RuntimeInterceptorRegistration[]>()

  constructor(interceptors: readonly (RuntimeInterceptor | RuntimeInterceptorRegistration)[]) {
    for (const point of ["pre-step", "provider-request", "tool-pre-execute", "tool-post-execute", "turn-stopping"] as const) {
      this.byPoint.set(point, [])
    }
    for (let i = 0; i < interceptors.length; i++) {
      const item = interceptors[i]!
      const reg: RuntimeInterceptorRegistration = "interceptor" in item ? item : { interceptor: item, order: 0 }
      this.byPoint.get(reg.interceptor.point)!.push(reg)
    }
    for (const list of this.byPoint.values()) {
      list.sort((left, right) => left.order - right.order)
    }
  }

  async run<T>(point: RuntimeInterceptorPoint, input: unknown): Promise<T> {
    const list = this.byPoint.get(point) ?? []
    if (list.length === 0) return input as T
    const interceptors = list.map((entry) => entry.interceptor)

    const dispatch = async (index: number, value: unknown): Promise<unknown> => {
      if (index >= interceptors.length) return value
      const interceptor = interceptors[index]!
      let called = false
      return interceptor.intercept(value, async (nextValue) => {
        if (called) {
          throw new AgentError("INTERCEPTOR_NEXT_REPEATED", "interceptor next() 重复调用", 500)
        }
        called = true
        return dispatch(index + 1, nextValue)
      })
    }

    return (await dispatch(0, input)) as T
  }
}
