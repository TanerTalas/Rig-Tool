/**
 * Annotation dosyalarının (landmarks.json, ileride regions.json) diske
 * yazılması ve okunması.
 *
 * Kullanıcı işi yarıda bırakıp devam edebilmeli; bu yüzden JSON kaydetme
 * Aşama 6'yı beklemeden Aşama 1'de devreye giriyor.
 */

/** Tarayıcıda indirme tetikler. */
export function downloadJSON(data, fileName) {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), fileName);
}

/**
 * Blob indirir.
 *
 * URL hemen iptal edilmiyor: Chrome indirmeyi asenkron başlatıyor ve erken
 * revoke edilen URL'de dosya boş inebiliyor. Gecikmeli iptal hem güvenli hem
 * de sızıntı bırakmıyor.
 */
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 10000);
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
