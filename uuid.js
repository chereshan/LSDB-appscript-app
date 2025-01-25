/*
  UUIDv5 невозможно декодировать, даже если известен namespace. Таким образом, uuidv5 не обратимая трансформация. 
 */
// Функция для генерации UUID v5 из строки
function generateUUIDv5(name, namespace=undefined) {
  namespace = namespace ?? PropertiesService.getScriptProperties().getProperty('UUID_NAMESPACE');
  // Проверяем, является ли namespace валидным UUID
  if (!isValidUUID(namespace)) {
    throw new Error('Invalid namespace UUID');
  }

  // Преобразуем строку и пространство имен в массивы байтов
  const nameBytes = stringToBytes(name);
  const namespaceBytes = uuidToBytes(namespace);

  // Объединяем байты для хеширования
  const hashInput = new Uint8Array(namespaceBytes.length + nameBytes.length);
  hashInput.set(namespaceBytes, 0);
  hashInput.set(nameBytes, namespaceBytes.length);

  // Хешируем с использованием SHA-1
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, hashInput);

  // Форматируем хеш как UUID v5
  const uuidBytes = new Uint8Array(hash.slice(0, 16)); // SHA-1 выдает 20 байт, но нам нужно только 16

  return [
    bytesToHex(uuidBytes.slice(0, 4)),
    bytesToHex(uuidBytes.slice(4, 6)),
    bytesToHex(uuidBytes.slice(6, 8)),
    bytesToHex(uuidBytes.slice(8, 10)).replace(/(.{4})(.{4})/, '\$1-\$2'),
    bytesToHex(uuidBytes.slice(10, 16))
  ].join('-');
}

// Функция для проверки валидности UUID
function isValidUUID(uuid) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);
}

function TextEncoder() {
  // Функция для преобразования символа в его UTF-8 представление
  function utf8Encode(charCode) {
    if (charCode < 0x80) {
      return String.fromCharCode(charCode);
    } else if (charCode < 0x800) {
      return String.fromCharCode(0xC0 | (charCode >> 6), 0x80 | (charCode & 0x3F));
    } else if (charCode < 0x10000) {
      return String.fromCharCode(0xE0 | (charCode >> 12), 0x80 | ((charCode >> 6) & 0x3F), 0x80 | (charCode & 0x3F));
    } else if (charCode < 0x110000) {
      return String.fromCharCode(0xF0 | (charCode >> 18), 0x80 | ((charCode >> 12) & 0x3F), 0x80 | ((charCode >> 6) & 0x3F), 0x80 | (charCode & 0x3F));
    }
  }

  // Метод для кодирования строки в UTF-8
  this.encode = function(str) {
    let result = '';
    for (let i = 0; i < str.length; i++) {
      result += utf8Encode(str.charCodeAt(i));
    }
    return new Uint8Array(result.split('').map(function(char) {
      return char.charCodeAt(0);
    }));
  };
}

// Вспомогательная функция для преобразования строки в массив байтов
function stringToBytes(str) {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

// Вспомогательная функция для преобразования UUID в массив байтов
function uuidToBytes(uuid) {
  const uuidParts = uuid.split('-');
  const bytes = [];

  for (let i = 0; i < uuidParts.length; i++) {
    const part = uuidParts[i];
    bytes.push(parseInt(part.substring(0, 2), 16));
    bytes.push(parseInt(part.substring(2, 4), 16));
    if (i === 1) {
      bytes.push(parseInt(part.substring(4, 6), 16));
      bytes.push(parseInt(part.substring(6, 8), 16));
    }
  }

  return new Uint8Array(bytes);
}

// Вспомогательная функция для преобразования массива байтов в шестнадцатеричный строку
function bytesToHex(bytes) {
  return Array.from(bytes, byte => ('0' + byte.toString(16)).slice(-2)).join('');
}

// Пример использования
function testGenerateUUIDv5(myString=undefined) {
  myString = myString??'A491914/01/2025 00:36:49стимулы';
  const uuidV5 = generateUUIDv5(myString);
  Logger.log(uuidV5); // Выведет UUID v5, основанный на строке 'example.com'
}
//TUZyS21Yc3NDUEhqTVRISA
//079d9f77-b9ed-c918-cf92-88cb006cafa7
//YWRCT21SN0ZENXd5UzA2Vw
//db30524c-c82b-d2e4-93ed-5080b27a2f75