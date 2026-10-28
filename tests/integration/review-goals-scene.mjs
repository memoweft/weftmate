import assert from 'node:assert/strict';

/** Exercise every category before capturing the existing synthetic reminder. */
export async function prepareGoalsScene(page) {
  await page.getByRole('heading', { name: '目标', exact: true }).waitFor();
  const tabs = page.getByRole('tablist', { name: '目标分类', exact: true });
  assert.deepEqual(await tabs.getByRole('tab').allTextContents(), ['进行中', '提醒与定时任务', '长期目标']);
  const select = async name => {
    const tab = tabs.getByRole('tab', { name, exact: true });
    await tab.click();
    assert.equal(await tab.getAttribute('aria-selected'), 'true');
    const panel = page.getByRole('tabpanel', { name, exact: true });
    await panel.waitFor();
    return panel;
  };
  const tasks = await select('进行中');
  await tasks.getByRole('article').first().waitFor();
  const schedules = await select('提醒与定时任务');
  await schedules.getByRole('article', { name: '提交合成报告', exact: true }).waitFor();
  assert.equal(await tasks.isVisible(), false);
  const goals = await select('长期目标');
  await goals.getByRole('heading', { name: '长期目标', exact: true }).waitFor();
  await goals.getByRole('button', { name: '新建长期目标', exact: true }).waitFor();
  assert.equal(await schedules.isVisible(), false);
  await select('提醒与定时任务');
  await schedules.getByRole('article', { name: '提交合成报告', exact: true }).waitFor();
}
