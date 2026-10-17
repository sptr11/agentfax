import { describe, expect, it } from 'vitest'
import { htmlToText } from '../src/html-to-text.js'

describe('htmlToText', () => {
  it('keeps text and puts block elements on their own lines', () => {
    expect(htmlToText('<h1>Q3 report</h1><p>On-time was <b>94%</b>.</p><ul><li>Week 7: 83</li><li>Week 9: 90</li></ul>'))
      .toBe('Q3 report\nOn-time was 94%.\nWeek 7: 83\nWeek 9: 90')
  })

  it('decodes entities', () => {
    expect(htmlToText('<p>Tacos &amp; ramen &lt;3 &quot;yes&quot; &#39;ok&#39; &#x1F642; &nbsp;done</p>')).toBe('Tacos & ramen <3 "yes" \'ok\' 🙂 done')
  })

  it('drops script, style, template and noscript content', () => {
    expect(htmlToText('<p>Shown</p><script>steal()</script><style>p{}</style><template>t</template><noscript>n</noscript>')).toBe('Shown')
  })

  it.each([
    '<p hidden>secret</p>',
    '<div aria-hidden="true">secret</div>',
    '<span style="display:none">secret</span>',
    '<span style="visibility: hidden">secret</span>',
  ])('drops text a person would not see: %s', (html) => {
    expect(htmlToText(`<p>Shown</p>${html}`)).toBe('Shown')
  })

  it('separates table cells so rows stay readable', () => {
    expect(htmlToText('<table><tr><th>Place</th><th>Walk</th></tr><tr><td>Salad bar</td><td>in the building</td></tr></table>'))
      .toBe('Place | Walk\nSalad bar | in the building')
  })

  it('collapses whitespace', () => {
    expect(htmlToText('<p>  a\n\n   b  </p>\n\n\n<p>c</p>')).toBe('a b\nc')
  })
})
