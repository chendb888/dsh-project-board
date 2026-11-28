/**
 * Host 半：注册 projectBoard 投影单元 + task_claim/task_done 工具 + 路由。
 * 用动态 import + 时间戳 query，确保每次激活加载磁盘最新模块（绕开 loader/ESM 静态缓存）。
 */
export const inject = ['sessionProjections', 'tools', 'webServer']

export async function apply(ctx) {
  const v = Date.now()
  const { projectBoardProjection } = await import('./project-2-board/lib/projection.js?v=' + v)
  const { createClaimTool, createDoneTool } = await import('./project-2-board/lib/tools.js?v=' + v)
  const { registerRoutes } = await import('./project-2-board/lib/routes.js?v=' + v)
  const { registerAutoRoutes } = await import('./project-2-board/lib/auto.js?v=' + v)
  ctx.sessionProjections.register(projectBoardProjection)
  ctx.tools.register(createClaimTool(ctx))
  ctx.tools.register(createDoneTool(ctx))
  registerRoutes(ctx)
  registerAutoRoutes(ctx)
}
