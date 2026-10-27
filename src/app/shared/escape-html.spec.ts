import { escapeHtml } from './escape-html';

describe('escapeHtml', () => {
  it('turns markup characters into entities so a note shows as text', () => {
    expect(escapeHtml('temp < 40F & "rising" it\'s <b>')).toBe(
      'temp &#60; 40F &#38; &#34;rising&#34; it&#39;s &#60;b&#62;');
  });

  it('gives an empty string for null and undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('parses back to the original text', () => {
    const div = document.createElement('div');
    const text = '<img src=x onerror="alert(1)"> & more';
    div.innerHTML = `<span title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
    expect(div.querySelector('img')).toBeNull();
    expect(div.textContent).toBe(text);
    expect(div.querySelector('span')!.title).toBe(text);
  });
});
