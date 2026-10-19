// Supplemental H5 page operations; they never turn a failed chat creation into a pass.
export async function createPageReminder(ctx,{sessionId,text,minutes=6,evidencePrefix='h5-page'}){
 const {page}=ctx,at=new Date(Date.now()+minutes*60000),two=n=>String(n).padStart(2,'0');
 await page.locator('.goals-entry').click();
 await ctx.until(async()=>await page.locator('.goals-surface [aria-busy="true"]').count()===0,45000);
 await page.getByRole('button',{name:'新建定时任务',exact:true}).click();
 const form=page.locator('.goals-form');
 await form.getByRole('textbox',{name:'要做什么',exact:true}).fill(text);
 for(const [label,value]of [['所属对话',sessionId],['重复','once'],['到点做什么','reminder'],['日期 · 年',String(at.getFullYear())],['日期 · 月',two(at.getMonth()+1)],['日期 · 日',two(at.getDate())],['时间 · 小时',two(at.getHours())],['时间 · 分钟',two(at.getMinutes())]])
  await form.locator(`select[aria-label="${label}"]`).selectOption(value,{force:true});
 await form.getByRole('button',{name:'保存',exact:true}).click();await form.waitFor({state:'hidden'});
 const result={text,requestedLocalTime:at.toString(),schedules:await ctx.api('/schedules')};
 await ctx.save(`${evidencePrefix}-saved.json`,result);await ctx.shot(`${evidencePrefix}-saved`);return result;
}

export async function deletePageReminder(ctx,text,{evidencePrefix='h5-page'}={}){
 await ctx.page.locator('.goals-entry').click();
 await ctx.until(async()=>await ctx.page.locator('.goals-surface [aria-busy="true"]').count()===0,45000);
 await ctx.page.getByRole('button',{name:`更多操作 ${text}`,exact:true}).click();
 await ctx.page.getByRole('menuitem',{name:'删除',exact:true}).click();
 await ctx.page.getByRole('button',{name:'确认删除',exact:true}).click();
 await ctx.until(async()=>!(await ctx.api('/schedules')).body.items.some(row=>row.text===text),15000);
 await ctx.save(`${evidencePrefix}-deleted.json`,await ctx.api('/schedules'));await ctx.shot(`${evidencePrefix}-deleted`);
}

export async function createPageGoal(ctx,{sessionId,title,description}){
 await ctx.page.locator('.goals-entry').click();
 await ctx.until(async()=>await ctx.page.locator('.goals-surface [aria-busy="true"]').count()===0,45000);
 await ctx.page.getByRole('button',{name:'新建长期目标',exact:true}).click();
 const form=ctx.page.locator('.goals-form');
 await form.getByRole('textbox',{name:'目标标题',exact:true}).fill(title);
 await form.getByRole('textbox',{name:'目标说明',exact:true}).fill(description);
 await form.locator('select[aria-label="所属对话"]').selectOption(sessionId,{force:true});
 await form.getByRole('button',{name:'保存',exact:true}).click();await form.waitFor({state:'hidden'});
 await ctx.save('h5-goal-created.json',{ui:await ctx.snapshot(),goals:await ctx.api('/goals')});await ctx.shot('h5-goal-created');
}
