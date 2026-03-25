import { vi } from "vitest"

type Result = { data?: any; error?: any; count?: number }

type HandlerState = {
  table: string
  action: string
  payload: any
  selectArgs: any
}

type TableHandlers = {
  select?: (state: HandlerState) => Result | Promise<Result>
  single?: (state: HandlerState) => Result | Promise<Result>
  insert?: (state: HandlerState) => Result | Promise<Result>
  update?: (state: HandlerState) => Result | Promise<Result>
}

type HandlerMap = Record<string, TableHandlers>

type RpcHandlers = Record<string, (args: any) => Result | Promise<Result>>

export function createSupabaseMock(handlers: HandlerMap, rpcHandlers: RpcHandlers = {}) {
  const auth = {
    getUser: vi.fn().mockResolvedValue({
      data: {
        user: {
          id: "manager-1",
          app_metadata: { role: "manager" },
        },
      },
    }),
  }

  const from = (table: string) => {
    const tableHandlers = handlers[table] ?? {}
    const state: HandlerState = {
      table,
      action: "select",
      payload: null,
      selectArgs: null,
    }

    const execute = async (actionOverride?: string) => {
      const action = actionOverride ?? state.action
      const handler = (tableHandlers as any)[action] ?? tableHandlers.select
      if (handler) {
        return handler(state)
      }
      return { data: null, error: null }
    }

    const builder: any = {
      eq: () => builder,
      neq: () => builder,
      in: () => builder,
      order: () => builder,
      select: (...args: any[]) => {
        state.action = "select"
        state.selectArgs = args
        return builder
      },
      insert: (payload: any) => {
        state.action = "insert"
        state.payload = payload
        return builder
      },
      update: (payload: any) => {
        state.action = "update"
        state.payload = payload
        return builder
      },
      single: async () => execute("single"),
      then: (onFulfilled: any, onRejected: any) => {
        return Promise.resolve(execute()).then(onFulfilled, onRejected)
      },
    }

    return builder
  }

  const rpc = vi.fn(async (fnName: string, args: any) => {
    const handler = rpcHandlers[fnName]
    if (handler) {
      return handler(args)
    }
    return { data: null, error: null }
  })

  return { auth, from, rpc }
}
