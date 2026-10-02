/** Formal DSH V4 preset scope for the isolated Mod maintenance Agent. */
export const name = 'weftmate-alpha2-mod-maintainer'
export const inject = ['tools', 'weftmateAlpha2Mods']

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(ctx.weftmateAlpha2Mods.tool), 'weftmate-alpha2-mod-maintainer: scoped lifecycle tool')
}
