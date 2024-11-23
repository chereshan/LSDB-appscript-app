function adjustAndFormatDateUTC(inputDate) {
  // Создаем объект Date из входящей строки (время в UTC)
  const date = new Date(inputDate);
  // console.log(date)
  // Добавляем 7 часов (7 * 60 * 60 * 1000 миллисекунд) к UTC времени
  const adjustedTime = date.getTime() + 7 * 60 * 60 * 1000;

  // Создаем новый объект Date с учетом смещения на 7 часов
  const adjustedDateUTC = new Date(adjustedTime);

  // Формируем строку в нужном формате (DD/MM/YYYY HH:mm:ss)
  const year = adjustedDateUTC.getUTCFullYear();
  const month = (adjustedDateUTC.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = adjustedDateUTC.getUTCDate().toString().padStart(2, "0");
  const hours = adjustedDateUTC.getUTCHours().toString().padStart(2, "0");
  const minutes = adjustedDateUTC.getUTCMinutes().toString().padStart(2, "0");
  const seconds = adjustedDateUTC.getUTCSeconds().toString().padStart(2, "0");

  const formattedDate = `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  return formattedDate;
}

//учесть случай пустой задачи
function formatTaskForSpreadSheet(task) {
  var final_task = {
    date: "nan",
    sector: "nan",
    y: "0",
    b: "0",
    t: "0",
    uuid: "nan",
    comment: "",
  };
  var title = task["title"];
  var notes = task["notes"];
  if (notes == undefined) {
    // console.log('Пустая задача')
    return undefined;
  }
  var completed = task["completed"];
  var id = task["id"];
  var dig = notes.toLowerCase().match(/ (\d+?)$|^(\d+?) | (\d+?) |^(\d+?)$/giu);
  dig = +(!dig ? 1 : dig[0].trim());
  var value = notes
    .toLowerCase()
    .match(/ ([бвbтtуy])$|^([бвbтtуy]) | ([бвbтtуy]) |^([бвbтtуy])$/giu);
  var sector = notes
    .replace(/ ([бвbтtуy])$|^([бвbтtуy]) | ([бвbтtуy]) |^([бвbтtуy])$/, " ")
    .replace(/ (\d+?)$|^(\d+?) | (\d+?) |^(\d+?)$/, " ")
    .trim();
  value = value[0]
    .trim()
    .replace(/[бв]/, "b")
    .replace(/у/, "y")
    .replace(/т/, "t");
  final_task[value] = `${dig}`;
  sector = !sector ? (value == "b" ? "другое" : "nan") : sector;
  final_task["sector"] = sector.toLowerCase();
  final_task["comment"] = title.toLowerCase() == sector ? "" : title;
  final_task["date"] = adjustAndFormatDateUTC(completed);
  final_task["uuid"] = generateUUIDv5(
    id,
    "5d063008-14c5-4b96-8b74-8e959827df60",
  );
  return final_task;
}

function areSetsEqual(setA, setB) {
  return setA.size === setB.size && [...setA].every((item) => setB.has(item));
}

function transformArrayToObjects(data) {
  var result = {};
  var headers_obj = {};
  for (var key in data) {
    result[key] = [];
    var headers = data[key].map((el) => {
      return el[0];
    });
    headers_obj[key] = headers;
    var len = data[key][0].length;
    for (var i = 1; i < len; i++) {
      result[key].push({});
      for (var j = 0; j < headers.length; j++) {
        result[key][i - 1][headers[j]] = data[key][j][i];
      }
    }
  }
  return [result, headers_obj];
}

function transposeArray(inputArray) {
  // Проверяем, есть ли входные данные
  if (!inputArray.length) return [];
  // Создаем новый массив для транспонированных данных
  const transposed = [];
  // Проходим по каждому элементу входного массива
  for (let i = 0; i < inputArray[0].length; i++) {
    // Создаем новый массив для текущего столбца
    transposed[i] = [];
    // Проходим по каждой строке входного массива
    for (let j = 0; j < inputArray.length; j++) {
      // Добавляем элемент в транспонированный массив
      transposed[i][j] = inputArray[j][i];
    }
  }
  return transposed;
}

function properFormat(date){
  var regex = /(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{1,2}):(\d{1,2})/;
  var match = date.match(regex);
  var matchstring=`${match[1].length==2?match[1]:'0'+match[1]}/${match[2].length==2?match[2]:'0'+match[2]}/${match[3]} ${match[4].length==2?match[4]:'0'+match[4]}:${match[5].length==2?match[5]:'0'+match[5]}:${match[6].length==2?match[6]:'0'+match[6]}`
  return moment(matchstring, 'DD/MM/YYYY HH:mm:ss')
}


function groupAndSumByKeys(arr, groupByKey, sumKeys) {
  return arr.reduce((acc, current) => {
    const groupValue = current[groupByKey];
    if (!acc[groupValue]) {
      acc[groupValue] = {};
      sumKeys.forEach((key) => {
        acc[groupValue][key] = 0;
      });
    }
    sumKeys.forEach((key) => {
      if (Number.isInteger(current[key])){
        acc[groupValue][key] += current[key];
      }
      else {
        acc[groupValue][key] = current[key];
      }
    });
    return acc;
  }, {});
}

function missingDateFill(obj, iter, format) {
  const startDate = moment.min(
    Object.keys(obj).map((el) => moment(el, format)),
  );
  const endDate = moment(new Date()).add(1, "month");
  const existingDates = Object.keys(obj).map((el) => moment(el, format));
  let allDates = [];
  for (let d = startDate; d.isSameOrBefore(endDate); d.add(1, iter)) {
    allDates.push(d.format(format));
  }
  const finalkeys = Object.keys(obj[Object.keys(obj)[0]]);
  var finalobj = allDates.reduce((acc, key) => {
    acc[key] =
      obj[key] === undefined
        ? finalkeys.reduce((acc, current) => ({ ...acc, [current]: 0 }), {})
        : obj[key];
    return acc;
  }, {});
  return finalobj;
}

function logTable(data) {
    // Заголовки таблицы
    const headers = Object.keys(data[0]);
    // Логирование заголовков
    Logger.log(headers.join("\t")); // Вывод заголовков через табуляцию
    // Логирование данных
    data.forEach(row => {
        Logger.log(headers.map(header => row[header]).join("\t")); // Вывод данных через табуляцию
    });
}

function sqlJsToConsoleTable(result) {
// Проверяем, есть ли в результате данные
  if (result.length === 0) {
    console.log("Нет данных для отображения.");
    return;
  }

  // Получаем данные из результата
  const tableData = result[0].values;
  const columns = result[0].columns;

  // Преобразуем данные в формат, пригодный для console.table
  const consoleTableData = tableData.map((row) => {
    const rowData = {};
    row.forEach((value, index) => {
        rowData[columns[index]] = value;
    });
    return rowData;
  });

// Выводим данные в консоль в формате таблицы
  logTable(consoleTableData);
}

function getDatesArray(startDate, endDate) {
    // Создаем массив для хранения дат
    var datesArray = [];
    
    // Преобразуем входные даты в объекты moment (создаем новые экземпляры moment, чтобы предотвратить изменение на месте (утечек))
    var start = moment(startDate);
    var end = moment(endDate);
    
    // Проверяем, что начальная дата меньше или равна конечной
    if (start.isAfter(end)) {
        return []; // Возвращаем пустой массив, если даты некорректны
    }

    // Итерируем от начальной даты до конечной
    while (start.isSameOrBefore(end)) {
        datesArray.push(start.format('YYYY/MM/DD')); // Форматируем дату и добавляем в массив
        start.add(1, 'days'); // Добавляем один день
    }
    
    return datesArray;
}

function testSQLiteFormat(str){
  if (Number.isInteger(str)){
    return `INTEGER`
  }
  else if (/\d{4}-\d{2}-\d{2}/.test(str)){
    return `DATE NOT NULL`
  }
  else {
    return `TEXT`
  }
}

function trimSubarrays(data) {
  const result = JSON.parse(JSON.stringify(data)); // Копируем данные, чтобы не изменять оригинал

  for (const key in result) {
    const arrays = result[key];
    if (Array.isArray(arrays)) {
      // Определяем минимальную длину, игнорируя полностью пустые строки
      const lengths = arrays.map((arr) => {
        if (arr.every((value) => value === "")) return 0; // Если вся строка пустая, длина 0
        let length = arr.length;
        while (length > 0 && arr[length - 1] === "") {
          length--;
        }
        return length;
      });

      const minLength = Math.max(...lengths); // Используем максимальную длину

      for (let i = 0; i < arrays.length; i++) {
        result[key][i] = arrays[i]
          .slice(0, minLength)
          .concat(Array(Math.max(0, minLength - arrays[i].length)).fill(""));
      }
    }
  }

  return result; // Возвращаем результат
}