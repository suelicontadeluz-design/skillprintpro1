import assert from 'node:assert/strict';
import {
  normalizeHttpUrl,
  extractUrlsFromText,
  classifyProvider,
  classifyKind,
  telemetryForUrl,
  inspectAnthropicWebFetchResponse,
} from './external-link-intake-core.ts';

const cases = [
  ['https://drive.google.com/file/d/abc/view?usp=sharing', 'GOOGLE_DRIVE', 'DOCUMENT'],
  ['https://docs.google.com/document/d/abc/edit', 'GOOGLE_DRIVE', 'DOCUMENT'],
  ['https://www.canva.com/design/DAFabc/view', 'CANVA', 'DESIGN'],
  ['https://www.dropbox.com/scl/fi/abc/a.png?rlkey=x', 'DROPBOX', 'IMAGE'],
  ['https://1drv.ms/u/s!abc', 'ONEDRIVE', 'WEB'],
  ['https://we.tl/t-abc', 'WETRANSFER', 'WEB'],
  ['https://cdn.example.com/artes/pedra.png?token=123', 'DIRECT_FILE', 'IMAGE'],
  ['https://example.com/catalogo', 'WEB_PAGE', 'WEB'],
];

for (const [url, provider, kind] of cases) {
  assert.equal(classifyProvider(url), provider, url);
  assert.equal(classifyKind(url), kind, url);
}

assert.equal(normalizeHttpUrl('javascript:alert(1)'), null);
assert.equal(normalizeHttpUrl('https://example.com/a.png).'), 'https://example.com/a.png');
assert.deepEqual(
  extractUrlsFromText('Olha https://example.com/a e também https://drive.google.com/file/d/1/view.'),
  ['https://example.com/a', 'https://drive.google.com/file/d/1/view']
);

const tel = telemetryForUrl('https://drive.google.com/file/d/abc/view?usp=sharing');
assert.equal(tel?.host, 'drive.google.com');
assert.equal(tel?.provider, 'GOOGLE_DRIVE');
assert.equal(tel?.has_query, true);

assert.deepEqual(
  inspectAnthropicWebFetchResponse({content:[{type:'server_tool_use',name:'web_fetch'},{type:'web_fetch_tool_result',content:[{type:'web_fetch_result'}]}]}),
  {status:'FETCH_SUCCEEDED', error_code:null, result_count:1}
);
assert.deepEqual(
  inspectAnthropicWebFetchResponse({content:[{type:'web_fetch_tool_result',content:{type:'web_fetch_tool_result_error',error_code:'url_not_allowed'}}]}),
  {status:'FETCH_FAILED', error_code:'url_not_allowed', result_count:0}
);
assert.deepEqual(
  inspectAnthropicWebFetchResponse({content:[{type:'text',text:'ok'}]}),
  {status:'FETCH_NOT_OBSERVED', error_code:null, result_count:0}
);

console.log('PASS external-link-intake-core', cases.length + 7, 'assertion groups');
