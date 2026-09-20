import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { messages } from '../i18n/messages';
import { HarmonicSpace } from './HarmonicSpace';

function classicalButton(html: string): string {
  const controls = html.match(
    /<div class="space-styles"[^>]*>(.*?)<\/div>/,
  )?.[1];
  const button = controls?.match(/<button[^>]*>Classical<\/button>/)?.[0];
  if (!button) throw new Error('Classical style button is missing');
  return button;
}

it('disables Classical for the public and pop/jazz trial models', () => {
  const common = {
    t: messages.ja,
    sounding: null,
    onChoose: () => {},
    onResetAudio: () => {},
  };
  const popJazz = renderToStaticMarkup(
    <HarmonicSpace
      {...common}
      modelOverlay={{
        candidates: [],
        candidateTypes: new Map(),
        historyLimit: 48,
        trainedStyles: ['jazz', 'pop'],
        onContextChange: () => {},
      }}
    />,
  );
  expect(classicalButton(popJazz)).toContain('disabled=""');
  const published = renderToStaticMarkup(<HarmonicSpace {...common} />);
  expect(classicalButton(published)).toContain('disabled=""');
});
