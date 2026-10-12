export const esc=value=>String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export const icon=id=>`<svg class="icon" aria-hidden="true"><use href="#i-${id}"></use></svg>`;
export const bubble=text=>`<div class="chat-user">${esc(text)}</div>`;
export const answer=text=>`<p class="chat-assistant">${esc(text)}</p>`;
export const progress=text=>`<p class="demo-progress">${icon('allow')}${esc(text)}</p>`;
export function files(c,{quarter=false,interactive=true}={}) {
 const rows=quarter?[[c.quarterFile,c.quarterMeta,'quarter']]:[[c.report,c.reportMeta,'report'],[c.inventory,c.inventoryMeta,'inventory']];
 return `<div class="demo-results"><p>${quarter?c.quarterReady:c.results}</p><div class="result-list">${rows.map(([name,meta,id])=>`<${interactive?'button type="button" data-action="preview" data-file="'+id+'"':'div'} class="result-row">${icon('file')}<strong>${esc(name)}</strong><span>${esc(meta)}</span>${icon('chevron')}</${interactive?'button':'div'}>`).join('')}</div></div>`;
}
export function preview(c,file='report') {
 const quarter=file==='quarter',inventory=file==='inventory';const title=quarter?c.quarterFile:inventory?c.inventory:c.report;
 const bullets=quarter?c.quarterPoints:c.reportPoints;
 const rows=quarter?c.quarterTable:inventory?c.inventoryTable:c.reportTable;
 return `<header class="preview-top"><div>${icon(quarter?'book':'file')}<strong>${esc(title)}</strong></div><button class="icon-button" type="button" data-action="close-preview" aria-label="${c.closePreview}">${icon('deny')}</button></header><article class="report-preview"><p class="document-meta">${quarter?c.quarterDocumentMeta:c.reportDocumentMeta}</p><h3>${quarter?c.quarterDocumentTitle:inventory?c.inventoryTitle:c.reportTitle}</h3><p>${quarter?c.quarterIntro:c.reportIntro}</p><h4>${c.reportHighlights}</h4><ul>${bullets.map(s=>`<li>${esc(s)}</li>`).join('')}</ul><h4>${quarter?c.quarterTableTitle:c.reportTableTitle}</h4><div class="preview-table"><table><thead><tr>${rows[0].map(s=>`<th scope="col">${esc(s)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(row=>`<tr>${row.map(s=>`<td>${esc(s)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="document-note">${c.documentNote}</p></article>`;
}
