/**
 * Annotation dosyalarının (landmarks.json, ileride regions.json) diske
 * yazılması ve okunması.
 *
 * Kullanıcı işi yarıda bırakıp devam edebilmeli; bu yüzden JSON kaydetme
 * Aşama 6'yı beklemeden Aşama 1'de devreye giriyor.
 */

/** Tarayıcıda indirme tetikler. */
export function downloadJSON(data, fileName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();

  URL.revokeObjectURL(url);
}

/** Dosya seçtirir ve JSON olarak parse eder. Kullanıcı iptal ederse null döner. */
export function pickJSONFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        resolve(await readJSONFile(file));
      } catch (error) {
        reject(error);
      }
    });

    input.click();
  });
}

export async function readJSONFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

/**
 * Annotation'ın yüklü modele ait olup olmadığını kontrol eder.
 * Farklı modele ait landmark yüklemek sessizce yanlış iskelet üretir,
 * o yüzden uyarı verip kararı kullanıcıya bırakıyoruz.
 */
export function checkModelHash(json, modelHash) {
  if (!json?.modelHash || !modelHash) return { match: true, known: false };
  return { match: json.modelHash === modelHash, known: true };
}
