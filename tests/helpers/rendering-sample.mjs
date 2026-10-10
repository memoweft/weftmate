import {deflateSync} from 'node:zlib';
function crc(data){let value=0xffffffff;for(const byte of data){value^=byte;for(let n=0;n<8;n++)value=value>>>1^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function chunk(name,data){const tag=Buffer.from(name),length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([tag,data])));return Buffer.concat([length,tag,data,sum]);}
function png(){const width=480,height=240,header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;const raw=Buffer.alloc(height*(1+width*3));for(let y=0;y<height;y++)for(let x=0;x<width;x++){const offset=y*(1+width*3)+1+x*3;raw[offset]=x<240?160:190;raw[offset+1]=y<120?180:210;raw[offset+2]=x<240?180:130;}return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
export const sampleImage=png();
export const renderingSample=`# 一份可以读、可以用的回复

这条**渲染样张**覆盖中文 English 混排、*强调*、~~删除~~与 \`inline code\`。

## 先把事情理清楚

1. 确定目标
   - 保留原始内容
   - [x] 代码与表格可以复制
   - [ ] 再检查成果
2. 查看引用与来源

> 好的排版，让复杂内容更容易读懂。
> 引用支持 **粗体** 和换行。

[示例站点](https://example.com/a-very-long-address-that-wraps-without-breaking-the-message-layout) · LongEnglishWordThatShouldWrapEvenWithoutAnySpacesInsideTheMessageBubble[^note]

---

## 代码 · 可以直接复制

\`\`\`python
def welcome(name: str) -> str:
    # 中英文注释与字符串
    return f"你好，{name}!"

print(welcome("WeftMate"))
\`\`\`

\`\`\`typescript
${Array.from({length:42},(_,i)=>`const item${i+1} = { label: "第 ${i+1} 项", done: ${i%2===0} };`).join('\n')}
\`\`\`

## 表格 · 保留列的宽度

| 事项 | 状态 | 数量 | 备注与链接 |
| :--- | :---: | ---: | :--- |
| 代码高亮 | 已完成 | 40 | 窄屏仍可横向滚动，长内容不会挤压文字 |
| 离线公式 | 已完成 | 2 | 无须加载外部字体或脚本 |
| 图表 | 可切换源码 | 1 | 渲染失败会保留原文 |
| 图片 | 可查看 | 2 | 使用合成色板，非个人照片 |

## 公式与图表

行内公式 $E=mc^2$，以及求和：

$$
\\sum_{i=1}^{n}i=\\frac{n(n+1)}{2}
$$

\`\`\`mermaid
graph LR
 A[理解目标] --> B[执行步骤]
 B --> C[查看成果]
\`\`\`

## 图片与文件

![合成色板 A](data:image/png;base64,${sampleImage.toString('base64')})
![合成色板 B](data:image/png;base64,${sampleImage.toString('base64')})

文件：渲染样张.md、合成报告.docx、合成表格.xlsx、合成演示.pptx。

## 失败时仍能读到原文

不支持的公式：$\\notafunction{a}$

\`\`\`mermaid
not-a-diagram
\`\`\`

![打不开的合成图](data:image/png;base64,AA==)

[^note]: 这是脚注说明，只含合成内容。
`;
export const userSample='请阅读 **这条用户消息**：\n\n- [x] Markdown 也用于我的消息\n- `safe code`\n\n> 不执行消息中的 HTML。';
