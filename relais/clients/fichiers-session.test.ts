import { describe, expect, test } from 'bun:test';
import { reponseFichier } from './fichiers-session.ts';

const base64 = (texte: string): string => Buffer.from(texte).toString('base64');

describe('reponseFichier', () => {
  test('un HTML est servi sous CSP sandbox, avec son type et sans devinette', async () => {
    const r = reponseFichier({ nom: 'page.html', mime: 'text/html', base64: base64('<p>x</p>') }, false);
    expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(r.headers.get('content-security-policy')).toBe('sandbox');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''page.html");
    expect(await r.text()).toBe('<p>x</p>');
  });

  test('un SVG est aussi sous sandbox ; une image PNG ne l’est pas', () => {
    expect(
      reponseFichier({ nom: 'a.svg', mime: 'image/svg+xml', base64: base64('<svg/>') }, false).headers.get(
        'content-security-policy',
      ),
    ).toBe('sandbox');
    expect(
      reponseFichier({ nom: 'a.png', mime: 'image/png', base64: base64('png') }, false).headers.get(
        'content-security-policy',
      ),
    ).toBeNull();
  });

  test('téléchargement sur demande, nom accentué encodé', () => {
    const r = reponseFichier({ nom: 'Bilan été.csv', mime: 'text/csv', base64: base64('a,b') }, true);
    expect(r.headers.get('content-disposition')).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('Bilan été.csv')}`,
    );
    expect(r.headers.get('content-type')).toBe('text/csv; charset=utf-8');
  });
});
