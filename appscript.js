//=========================================================================
/*
Как все должно работать: 
1. Каждый день в 0:00 в списках остаются только задачи на следующий день
  * Модель недостающие появляются - избыточные исчезают стоит реализовывать, если я захочу в списки добавлять свои задачи на следующий день. Пока от такого подхода выигрыш неочевиден.
  * Вместо этого можно просто очистить все списки и заново их заполнить.
2. Каждый день после 0:00 приложение собирает список выполненных задач за прошедшие сутки и производит их пуш в БД
  * Нужен контроль коллизий (пуш двух одинаковых задач) - выполняется с помощью uuid
  * Нужно реализовать контроль версий - полная синхронизация ставит временную отметку (нужна state variable)
  * Нужно иметь таблицу про запас на тот случай, если вдруг myScale будет idle более 7 дней, чтобы была возможность ее восстановить

3. То, какие задачи пополняются зависит от конфига, заданного в БД. В нем можно задать день недели или кокретную дату появления регулярной задачи. Идея: конфиг внутри Google Tasks с помощьб отдельного листа

todo: сделать все функции с потенциалом к превышению квоты асинхронными (добавить обработчик ошибок с экспоненциальным ожиданием) - можно в 1 функцию addTask()
  * те списки, для которых порядок задач имеет значение - синхронные (Утро,Вечер,t)
  * те списки, для которых не имеет - асихронные (b,y)
todo: запросам к БД sql вероятно стоит быть асинхронными, т.к. их порядок в БД не имеет значения
todo: Написать функцию, которая возращает все выполненные задачи за данный период

ТЕУЩАЯ ИНФОРМААЦИЯ 1
В таблице Google Sheets сейчас задачи с uuid v4, который нельзя однозначно получить из строки. 
Поэтому не работает защита от коллизий. 
Однако выполненные задачи начиная с 31.01 все еще хранятся в приложении Google Tasks.
Поэтому, мы можем перевыгрузить все задачи, начиная с этой даты с uuid v5 осованному на id задачи. 
Т.к. очень маловероятно повторение uuid, то очень маловероятен риск его совпадения с uuid до 31.01.
Однако скорее всего будут потеряны данные стимулов, которые в сою очередь всегда получаются функционально и потому могут быть восстановлены.

ТЕУЩАЯ ИНФОРМААЦИЯ 2
Перед тем, как настраивать БД на основе SQL надо иметь рабочий план Б в виде таблицы Google Sheets, т.к. сервис MyScale удаляет базу данных, если та idle после 7 дней, а у меня бывали периоды неиспользования LS и длиннее 7 дней.
Кроме того к примеру, там все еще не работает автоинкремент id, поэтому стоит сначала научится использовать эту БД с десктопа, а потом уже переходить на миграцию на нее. 
*/
// функция place-holder для заморозки триггера
function defunctTrigger(){
  console.log('Отработала заморозка триггера')
}

//=========================================================================
// Царь-функция каждого дня
//=========================================================================
function fillOnePush() {
  var regulars = checkConfigForRegulars();
  appendCompletedTasksToSheet()
    .then((rawData) => {
      for (key in regulars["completed"]) {
        var listlength = regulars["completed"][key].length;
        for (var i = 0; i < listlength; i++) {
          appendRuleBasedTasksToSheet(regulars["completed"][key][i], "push");
        }
      }
      console.log("Все выполненные задачи успешно добавлены в БД.");
      return rawData
    })
    .then((rawData)=>{
      return migrateTasksToSupabase(rawData)
    })
    .then(()=>{
      console.log("Все задачи успешно добавлены в Supabase.");
    })
    .catch((error) => {
      console.error("Произошла ошибка при добавлении задач в БД:", error);
    });
}
// ====================================================================
// ====================================================================
function fillOneDay() {
  var regulars = checkConfigForRegulars();
  deleteAllUncompletedTasks()
    .then(() => {
      console.log("Все невыполненные задачи успешно удалены из приложения.");
      for (key in regulars["app"]) {
        var listlength = regulars["app"][key].length;
        for (var i = 0; i < listlength; i++) {
          addTask(
            regulars["app"][key][i]["title"],
            regulars["app"][key][i]["notes"],
            key,
          );
        }
      }
      console.log("Все задачи успешно добавлены в приложение.");
      appendCompletedTasksToSheet()
        .then((rawData) => {
          for (key in regulars["completed"]) {
            var listlength = regulars["completed"][key].length;
            for (var i = 0; i < listlength; i++) {
              appendRuleBasedTasksToSheet(regulars["completed"][key][i], "day");
            }
          }
          console.log("Все выполненные задачи успешно добавлены в БД.");
          return rawData
        })
        .then((rawData)=>{
          return migrateTasksToSupabase(rawData)
        })
        .then(()=>{
          console.log("Все задачи успешно добавлены в Supabase.");
        })
        .catch((error) => {
          console.error("Произошла ошибка при добавлении задач в БД:", error);
        });
    })
    .catch((error) => {
      console.error(
        "Произошла ошибка при удалении невыполненных задач:",
        error,
      );
    });
}

function addTask(title, notes, tasklistname, attempt = 0) {
  const maxRetries = 5;

  var tasklistsids = readFromProperty('GSHEETS_CONFIG')["tasklist_ids"]
  // C датой-временем готово
  // ставит дедлайн до конца дня
  //получаем дату завтра для due в формате '2024-03-11T00:00:00Z'
  var date = new Date();
  date.setFullYear(date.getFullYear());
  date.setMonth(date.getMonth());
  date.setDate(date.getDate());
  //надо переводить из стандартного времени
  date.setHours(date.getHours() + 7);
  date = date.toISOString();

  console.log(title);
  console.log(date);
  console.log(notes);

  let task = {
    title: title,
    due: date,
    notes: notes,
  };
  try {
    if (attempt && attempt < maxRetries) {
      const waitTime = Math.pow(2, attempt) * 1000;
      console.log(`Попытка ${attempt}: ждем ${Math.pow(2, attempt)} сек`);
      Utilities.sleep(waitTime);
    }
    // Call insert method with taskDetails and taskListId to insert Task to specified tasklist.
    task = GoogleTasks.Tasks.insert(
      task,
      (tasklist = tasklistsids[tasklistname]),
    );
    // Print the Task ID of created task.
    console.log('Task with title "%s" was created.', task.title);
  } catch (err) {
    console.log("Failed with an error %s", err.message);
    if (err.message.includes("Quota Exceeded")) {
    }
    // TODO (developer) - Handle exception from Tasks.insert() of Task API
    if (attempt < maxRetries) {
      addTask(title, notes, tasklistname, attempt + 1);
    } else {
      console.log("Не удалось добавить задачу:" + task.title);
    }
  }
}

// ==========================================================================
// Чистка списка задач
// ==========================================================================
async function getNotcompletedTasks(tasklistId) {
  let tasks = [];
  let pageToken = null;

  do {
    const res = await GoogleTasks.Tasks.list(tasklistId, {
      showHidden: false,
      showCompleted: false,
      showDeleted: false,
      maxResults: 100,
      pageToken: pageToken,
    });
    console.log(res);
    if (res.items) {
      tasks = tasks.concat(res.items);
    }
    pageToken = res.nextPageToken;
  } while (pageToken);

  return tasks;
}

async function deleteTask(tasklistId, value) {
  // Максимальное количество попыток удаления задачи
  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      await GoogleTasks.Tasks.remove(tasklistId, value);
      console.log(`Задача ${value} успешно удалена.`);
      return; // Завершаем, если удаление прошло успешно
    } catch (error) {
      if (error.code === 429 || error.code === 403) {
        // Код ошибки 429 — превышение квоты
        attempt++;
        const waitTime = Math.pow(2, attempt) * 1000; // Экспоненциальная задержка
        console.log(
          `Превышена квота API. Попробуйте снова через ${waitTime / 1000} секунд. Попытка ${attempt} из ${maxRetries}.`,
        );
        await new Promise((resolve) => {
          Utilities.sleep(waitTime);
          resolve();
        }); // Задержка перед повторной попыткой
      } else {
        console.error("Ошибка при удалении задачи:", error);
        throw error; // Пробрасываем ошибку для обработки в родительском коде
      }
    }
  }

  console.log(
    `Не удалось удалить задачу ${value} после ${maxRetries} попыток.`,
  );
}

function deleteAllUncompletedTasks(days) {
  const lists = Object.fromEntries(
    Object.entries(readFromProperty('GSHEETS_CONFIG')["tasklist_ids"])
      .filter(([key]) => key !== "Мои задачи")
  )

  // Возвращаем промис, который разрешается, когда все задачи будут удалены
  return Promise.all(
    Object.values(lists).map((list) => {
      const tasklistId = list; // Замените на ваш список задач
      return getNotcompletedTasks(tasklistId).then((tasks) => {
        // Выводим информацию о задачах перед удалением
        tasks.forEach((task) =>
          console.log(`Удаляется задача (ID: ${task.id}) из списка "${list}".`),
        );
        // Создаем массив промисов для удаления задач
        const deletions = tasks.map((task) =>
          deleteTask(tasklistId, task.id)
            .then(() =>
              console.log(
                `Задача (ID: ${task.id}) успешно удалена из списка "${list}".`,
              ),
            )
            .catch((error) =>
              console.error(
                `Ошибка при удалении задачи (ID: ${task.id}) из списка "${list}":`,
                error,
              ),
            ),
        );
        // Ждем завершения всех операций удаления
        return Promise.all(deletions);
      });
    }),
  );
}

// ==========================================================================
// Пуш выполненных задач в БД
/*
Каждый день после 0:00 приложение собирает список выполненных задач за прошедшие сутки и производит их пуш в БД
  * Нужен контроль коллизий (пуш двух одинаковых задач) - выполняется с помощью uuid
  * Нужно реализовать контроль версий - полная синхронизация ставит временную отметку (нужна state variable)
  * Нужно иметь таблицу про запас на тот случай, если вдруг myScale будет idle более 7 дней, чтобы была возможность ее восстановить

ТЕУЩАЯ ИНФОРМААЦИЯ
В таблице Google Sheets сейчас задачи с uuid v4, который нельзя однозначно получить из строки. 
Поэтому не работает защита от коллизий. 
Однако выполненные задачи начиная с 31.01 все еще хранятся в приложении Google Tasks.
Поэтому, мы можем перевыгрузить все задачи, начиная с этой даты с uuid v5 осованному на id задачи. 
Т.к. очень маловероятно повторение uuid, то очень маловероятен риск его совпадения с uuid до 31.01.
Однако скорее всего будут потеряны данные стимулов, которые в сою очередь всегда получаются функционально и потому могут быть восстановлены.
 */
// ==========================================================================
// todo: если без даты, то возращает все. Или же, если дата не задана, то за вчера. Надо определиться.
async function getCompletedTasks_byId(tasklistId) {
  let tasks = [];
  let pageToken = null;
  let date1 = new Date("2024-01-01");
  date1 = date1.toISOString();
  // запрос на выполненные задачи всегда дожен содержать начальную дату периода, когда они были выполнены, т.к. иначе запрос выдаст в том числе невыполненые задачи
  do {
    const res = await GoogleTasks.Tasks.list(tasklistId, {
      showHidden: true,
      showCompleted: true,
      showDeleted: true,
      completedMin: date1,
      pageToken: pageToken,
    });

    if (res.items) {
      tasks = tasks.concat(res.items);
    }
    pageToken = res.nextPageToken;
  } while (pageToken);
  return tasks;
}
//время завершения задачи изначально дается в формате мое время + 7
//=========================================================================
function getAllCompletedTasks() {
  return getRawGoogleTasksData().then(tasks=>{
    let rawData=tasks
    let formatedData=tasks.map(task=>{
      return {
        id: task["id"],
        title: task["title"],
        notes: task["notes"],
        completed: task["completed"],
        status: task["status"],
      }
    })
    return [formatedData, rawData]
  })
}
//=========================================================================
//надо получить список всех выполненных задач в формате пригодном для пуша в бд
function getAllCompletedAndFormattedTasks() {
  return getAllCompletedTasks().then(([formatedData, rawData]) => {
    var tasks = formatedData;
    var rawData = rawData;
    var formattedtasks = [];
    for (var i = 0; i < tasks.length; i++) {
      var ftask = formatTaskForSpreadSheet(tasks[i]);
      formattedtasks.push(ftask);
    }
    formattedtasks = formattedtasks.filter((val) => {
      return val != undefined;
    });
    return [formattedtasks, rawData];
  });
}
//=========================================================================
async function rewriteTaskWithRetry(
  range,
  values,
  maxRetries = 6,
  initialDelay = 1000,
) {
  var spreadsheetId = readFromProperty('GSHEETS_CONFIG')["spreadsheetId"];
  var sheetName = "tr_table"; // Имя листа, в котором будет происходить обновление
  var fullRange = sheetName + "!" + range;

  var resource = {
    values: values, // Убедитесь, что values - это двумерный массив
  };

  const attemptUpdate = async (retryCount = 0) => {
    try {
      const response = await GoogleSheets.Spreadsheets.Values.update(
        resource,
        spreadsheetId,
        fullRange,
        {
          valueInputOption: "USER_ENTERED", // 'RAW' или 'USER_ENTERED'
        },
      );
      console.log("Обновление данных выполнено успешно.");
      return response;
    } catch (error) {
      console.error(`ERROR(${error.code}):` + error.message);
      if (
        (error.message.includes(
          "Quota exceeded for quota metric 'Write requests' and limit 'Write requests per minute per user'",
        ) ||
          error.result.error.code === 502) &&
        retryCount < maxRetries
      ) {
        // Quota exceeded error, retry with exponential backoff
        console.warn(
          `Превышение квоты. Попытка ${retryCount + 1} из ${maxRetries}. Ожидание перед повтором...`,
        );
        const delay = initialDelay * Math.pow(2, retryCount);
        Utilities.sleep(delay);
        return attemptUpdate(retryCount + 1);
      } else if (error.result.error.code === 403 && retryCount < maxRetries) {
        // User rate limit exceeded error, retry with exponential backoff
        console.warn(
          `Превышение квоты. Попытка ${retryCount + 1} из ${maxRetries}. Ожидание перед повтором...`,
        );
        const delay = initialDelay * Math.pow(2, retryCount);
        Utilities.sleep(delay);
        return attemptUpdate(retryCount + 1);
      } else {
        console.error("Ошибка при обновлении данных: ", error);
        return Promise.reject(error); // Return a rejected promise instead of throwing an error
      }
    }
  };
  return attemptUpdate();
}
// ==========================================================================
// Гет задач из БД Google Sheets
// ==========================================================================
/*
{ date: '17/10/2022 00:00:00',
    sector: 'мильпопс',
    y: '1',
    b: '0',
    t: '0',
    uuid: '41445f91-aa98-4be4-806f-f6b08afa56d6',
    location: 'A2:F2' },
 */
async function getTr_table(byrange = false) {
  const spreadsheetId = readFromProperty('GSHEETS_CONFIG')["spreadsheetId"]
  const range = "tr_table"
  var values = await GoogleSheets.Spreadsheets.Values.get(
    spreadsheetId,
    range,
  ).values;
  // Создаем массив для хранения содержимого ячеек
  var results = [];

  if (values) {
    if (byrange) {
      // Если byrange установлен в true, сохраняем данные с координатами ячеек
      for (var row = 0; row < values.length; row++) {
        for (var col = 0; col < values[row].length; col++) {
          var cellValue = values[row][col];
          var cellAddress = String.fromCharCode(65 + col) + (row + 1);
          results.push({
            location: cellAddress,
            value: cellValue,
          });
        }
      }
    } else {
      // Если byrange установлен в false, создаем объекты с ключами из заголовков
      for (var i = 1; i < values.length; i++) {
        var rowData = values[i];
        var rowObject = {};
        for (var j = 0; j < rowData.length; j++) {
          var key = values[0][j]; // Заголовок столбца
          rowObject[key] = rowData[j];
        }
        // Добавляем локацию в виде диапазона строки (например, "A2:E2" для первой строки данных)
        var locationStart = String.fromCharCode(65) + (i + 1);
        var locationEnd = String.fromCharCode(64 + rowData.length) + (i + 1);
        rowObject.location = locationStart + ":" + locationEnd;
        results.push(rowObject);
      }
    }
  }

  // console.log(results);
  // Возвращаем массив результатов
  return results;
}
/*
[ { title: '',
    sector: 'стимулы',
    period: 'day',
    transform: 'if (day.y<6) {"стимулы b":nextday=(day.y-6)*2}' },
  { title: '',
    sector: 'стимулы',
    period: 'push',
    transform: 'if (day.y>6) {"стимулы b":day=day.y}' } ]
 */
//===================================================================
//Использование конфига
//===================================================================
function getConfig(LastCongigUpdate) {
  LastCongigUpdate = LastCongigUpdate ?? undefined;
  var spreadsheetId = readFromProperty('GSHEETS_CONFIG')["spreadsheetId"];
  var range = "config";

  var sheet = GoogleSheets.Spreadsheets.Values.get(spreadsheetId, range);
  // Транспонируем данные
  const transposedData = transposeArray(sheet.values);
  // Фильтруем данные, заменяя undefined на пустую строку
  const filteredData = transposedData.map((list) => {
    return list.map((sublist) => (sublist === undefined ? "" : sublist));
  });

  var arr = filteredData;
  var obj = {};

  // Создаем объект, группируя данные по ключу
  for (var i = 0; i < arr.length; i++) {
    // Проверяем, если строка не пустая
    if (arr[i].length > 0 && arr[i][0] !== "") {
      // console.log("Обрабатываем строку:", arr[i]); // Логируем обрабатываемую строку
      if (!(arr[i][0] in obj)) {
        // Сохраняем все значения, начиная с 1
        obj[arr[i][0]] = [arr[i].slice(1)]; // Сохраняем все значения, начиная с 1
      } else {
        obj[arr[i][0]].push(arr[i].slice(1)); // Добавляем значения
      }
    }
  }
  var LastUpdate = obj.LastUpdate ? obj.LastUpdate[0][0] : null; // Проверяем, существует ли LastUpdate

  if (new Date(LastCongigUpdate) >= new Date(LastUpdate)) {
    return false;
  }

  delete obj.LastUpdate;
  // Применяем функцию обрезки подмассивов
  obj = trimSubarrays(obj);
  var [obj, headers] = transformArrayToObjects(obj);
  var final_obj = {};

  for (key in obj) {
    [listname, f] = headersTemplateVariations(headers[key]);
    if (f) {
      final_obj[listname] = final_obj[listname] ?? {};
      final_obj[listname][key] = f(obj[key]);
    }
  }
  // console.log(final_obj);
  return { LastUpdate: LastUpdate, regulars: final_obj };
}
//=========================================================================
function headersTemplateVariations(headers) {
  //Эта функция должна получать массив
  //title, time, sector
  //определяем по какому хедеру упорядочивание
  var orderedby = false;
  var final_headers = {};
  headers.forEach((value) => {
    final_headers[value] = value;
  });
  //поиск сортирующего хедера
  var orderedbyId = headers.findIndex((element) => element.includes("order"));
  if (orderedbyId != -1) {
    orderedby = headers[orderedbyId].replace("order", "").trim();
    final_headers[headers[orderedbyId]] = orderedby;
  }

  var notes_quantificatorId = headers.findIndex((element) =>
    element.match(/notes \d{1,} [ybtуб]/),
  );
  if (notes_quantificatorId != -1) {
    const matchedString = headers[notes_quantificatorId];
    const regex = /notes (\d{1,}) ([ybtуб])/;
    const matches = matchedString.match(regex);
    const value = matches[1];
    const type = matches[2];
    final_headers[headers[notes_quantificatorId]] = headers[
      notes_quantificatorId
    ]
      .replace(value, "")
      .replace(type, "")
      .trim();
    final_headers[matches[1]] = "value";
    final_headers[matches[2]] = "type";
  }

  var value_quantificatorId = headers.findIndex((element) =>
    element.match(/value [ybtуб]/),
  );
  if (value_quantificatorId != -1) {
    const matchedString = headers[value_quantificatorId];
    const regex = /value ([ybtуб])/;
    const matches = matchedString.match(regex);
    const type = matches[1];
    final_headers[headers[value_quantificatorId]] = headers[
      value_quantificatorId
    ]
      .replace(type, "")
      .trim();
    final_headers[matches[1]] = "type";
  }

  var final_headers_set = new Set(Object.values(final_headers));

  var inverted_final_headers = Object.fromEntries(
    Object.entries(final_headers).map(([key, value]) => [value, key]),
  );

  if (areSetsEqual(final_headers_set, new Set(["title", "notes"]))) {
    return [
      "app",
      function (task_array) {
        var final_array = [];
        for (let i = 0; i < task_array.length; i++) {
          final_array.push({
            title: task_array[i][inverted_final_headers["title"]],
            notes: task_array[i][inverted_final_headers["notes"]],
          });
        }
        if (orderedby) {
          final_array
            .sort((a, b) => a[orderedby].localeCompare(b[orderedby]))
            .reverse();
        }
        return final_array;
      },
    ];
  } else if (
    areSetsEqual(
      final_headers_set,
      new Set(["sector", "notes", "value", "type"]),
    )
  ) {
    return [
      "app",
      function (task_array) {
        var final_array = [];
        for (let i = 0; i < task_array.length; i++) {
          var num = task_array[i][inverted_final_headers["notes"]];
          for (let j = 0; j < num; j++) {
            final_array.push({
              title: task_array[i][inverted_final_headers["sector"]],
              notes: `${inverted_final_headers["value"]} ${inverted_final_headers["type"]} ${task_array[i][inverted_final_headers["sector"]]}`,
            });
          }
        }
        if (orderedby) {
          final_array
            .sort((a, b) => a[orderedby].localeCompare(b[orderedby]))
            .reverse();
        }
        return final_array;
      },
    ];
  } else if (
    areSetsEqual(
      final_headers_set,
      new Set(["title", "sector", "value", "type"]),
    )
  ) {
    return [
      "app",
      function (task_array) {
        var final_array = [];
        for (let i = 0; i < task_array.length; i++) {
          final_array.push({
            title: task_array[i][inverted_final_headers["title"]],
            notes: `${task_array[i][inverted_final_headers["value"]]} ${inverted_final_headers["type"]} ${task_array[i][inverted_final_headers["sector"]]}`,
          });
        }
        if (orderedby) {
          final_array
            .sort((a, b) => a[orderedby].localeCompare(b[orderedby]))
            .reverse();
        }
        return final_array;
      },
    ];
  } else if (
    areSetsEqual(
      final_headers_set,
      new Set(["title", "startdate", "period", "transform"]),
    )
  ) {
    return [
      "completed",
      function (task_array) {
        var final_array = [];
        for (let i = 0; i < task_array.length; i++) {
          final_array.push({
            title: task_array[i][inverted_final_headers["title"]],
            startdate: task_array[i][inverted_final_headers["startdate"]],
            period: task_array[i][inverted_final_headers["period"]],
            transform: task_array[i][inverted_final_headers["transform"]],
          });
        }
        return final_array;
      },
    ];
  } else return [false, false];
}
//=========================================================================
function checkConfigForRegulars() {
  console.log("Проверяем config");
  var regulars;
  var scriptProperties = PropertiesService.getScriptProperties();
  lastConfigUpdate = scriptProperties.getProperty("lastConfigUpdate");
  if (lastConfigUpdate != null) {
    var config = getConfig(lastConfigUpdate);
    console.log("Проверяем актуальность config приложения");
    if (!config) {
      console.log("config приложения актуален");
      regulars = JSON.parse(scriptProperties.getProperty("regulars"));
    } else {
      console.log("config приложения НЕ актуален");
      regulars = config.regulars;
      var LastUpdate = config.LastUpdate;
      scriptProperties.setProperty("regulars", JSON.stringify(regulars));
      scriptProperties.setProperty("lastConfigUpdate", LastUpdate);
      console.log("config приложения обновлен");
    }
  } else {
    console.log("config приложения не существует");
    config = getConfig();
    var LastUpdate = config.LastUpdate;
    regulars = config.regulars;
    scriptProperties.setProperty("regulars", JSON.stringify(tasks_to_add_obj));
    scriptProperties.setProperty("lastConfigUpdate", LastUpdate);
  }
  // console.log(regulars);
  return regulars;
}
//=========================================================================
//=========================================================================
//=========================================================================
/*
Все преобразования БД могут происходит на языке sql, а не с помощью.
1. я получаю сырые данные БД и преобразую их БД, которое может обрабатываться с помощью sql
2. все правила 
*/
//=========================================================================
async function getRulesBasedCompletedTasks(rule) {
  //todo:чтобы не дублировать tr_table, надо, чтобы она поступала уже готовая
  var rule = checkConfigForRegulars()["completed"]["Правила"][0]["transform"];
  console.log(rule);
  // return;
  var frommatch = rule.match(/from\s+(\S+?)\s(?:as (\S+)\s)?/i);
  if (!frommatch) {
    console.error("No match found for FROM");
  }

  var fromrule = frommatch[1];
  var fromrulepseud = frommatch[2] ?? fromrule;

  var joinmatch = rule.match(/join\s+(\S+?)\s(?:as (\S+)\s)?/i);
  if (!joinmatch) {
    console.error("No match found for JOIN");
  } else {
    var joinrule = joinmatch[1];
    var joinrulepseud = joinmatch[2] ?? joinrule;
  }

  // Экранируем fromrule для использования в регулярном выражении
  var escapedFromRule = fromrulepseud.replace(/([.*+?^${}()|\[\]\\])/g, "\\$1");
  // Создаем регулярное выражение
  const fromagregex = new RegExp(
    `${escapedFromRule}\\\.([^\.\),\\s\-\\+\\*\\>\<\\= \!]+?)[\.\),\\s\-\\+\\*\\>\<\\= |!]`,
    "g",
  );
  // Ищем совпадения в строке
  var agregates = [];
  var match;
  // Используем цикл для извлечения всех совпадений
  while ((match = fromagregex.exec(rule)) !== null) {
    agregates.push(match[1]);
  }

  if (joinmatch != null) {
    var escapedJoinRule = joinrulepseud.replace(
      /([.*+?^${}()|\[\]\\])/g,
      "\\$1",
    );
    const joinagregex = new RegExp(
      `${escapedJoinRule}\\\.([^\.\),\\s\-\\+\\*\\>\<\\= \!]+?)[\.\),\\s\-\\+\\*\\>\<\\= |!]`,
      "g",
    );
    while ((match = joinagregex.exec(rule)) !== null) {
      agregates.push(match[1]);
    }
  }

  agregates = Array.from(new Set(agregates));
  // т.к. sql видимо довольно требовательный, то стоит получить сначала все возможные значения агрегатов
  // например, надо импутировать пропущенные даты
  // return false
  // TODO: инпутация пропусков дат с нулями
  var bdtasks_client = await getTr_table();
  var bdtasks = bdtasks_client.map((obj) => {
    return {
      ...obj,
      properdatetime: properFormat(obj["date"]),
    };
  });

  const mindatetime = moment.min(
    bdtasks.map((el) => {
      return el["properdatetime"];
    }),
  );
  const maxdatetime = moment(new Date());
  // console.log('!!!!!!')
  // console.log(maxdatetime)
  const alldates = new Set(getDatesArray(mindatetime, maxdatetime));
  var x = Array.from(alldates);
  // for (var i in x){
  //   console.log(x[i])
  // }

  const datesinbdtasks = new Set(
    bdtasks.map((obj) => {
      return obj["properdatetime"].format("YYYY/MM/DD");
    }),
  );
  const diffdates = Array.from(
    new Set([...alldates].filter((x) => !datesinbdtasks.has(x))),
  );

  for (let date of diffdates) {
    bdtasks.push({
      date: `${date} 00:00:00`,
      y: 0,
      b: 0,
      t: 0,
      properdatetime: moment(`${date.replaceAll("/", "-")}T00:00:00.000`),
    });
  }
  /*
  { date: '30/10/2022 23:59:59',
    sector: 'стимулы',
    y: '0',
    b: '-12',
    t: '0',
    uuid: '08a8765c-e588-4048-8741-3f6e4c0839b8',
    location: 'A35:F35',
    properdatetime: moment("2022-10-30T23:59:59.000") }
   */
  bdtasks = bdtasks.map((obj) => {
    return {
      ...obj,
      datetime: obj["properdatetime"].format("YYYY/MM/DD HH:mm:ss"),
      date: obj["properdatetime"].format("YYYY-MM-DD"),
      day: obj["properdatetime"].format("YYYY/MM/DD"),
      time: obj["properdatetime"].format("HH:mm:ss"),
      y: +obj["y"],
      b: +obj["b"],
      t: +obj["t"],
    };
  });

  const dayofweekRUS = {
    0: "ВС",
    1: "ПН",
    2: "ВТ",
    3: "СР",
    4: "ЧТ",
    5: "ПТ",
    6: "СБ",
  };
  moment.updateLocale("ru", {
    weekdays: [
      "Воскресенье",
      "Понедельник",
      "Вторник",
      "Среда",
      "Четверг",
      "Пятница",
      "Суббота",
    ],
    weekdaysShort: ["ВС", "ПН", "ВТ", "СР", "ЧТ", "ПТ", "СБ"],
  });
  bdtasks = bdtasks.map((obj) => {
    return {
      ...obj,
      week: obj["properdatetime"].format("WW"),
      dayOfWeek: dayofweekRUS[obj["properdatetime"].format("d")],
    };
  });
  bdtasks = bdtasks.map((obj) => {
    return {
      ...obj,
      "year-week": obj["properdatetime"].format("YYYY") + "-W" + obj["week"],
      "week-dayOfWeek": obj["week"] + "-" + obj["dayOfWeek"],
      "year-week-dayOfWeek":
        obj["properdatetime"].format("YYYY") +
        "-W" +
        obj["week"] +
        "-" +
        obj["dayOfWeek"],
    };
  });

  const uniqueSectors = Object.fromEntries(
    Array.from(new Set(bdtasks.map((item) => item["sector"])))
      .filter((item) => item != null)
      .map((item) => [item, 0]),
  );

  bdtasks = bdtasks.map((obj) => {
    const newObj = { ...obj, ...uniqueSectors };
    const { y, b, t } = newObj;
    var value;
    if (y != 0 || b != 0 || t != 0) {
      if (y != 0) {
        value = y;
      } else if (b != 0) {
        value = b;
      } else {
        value = t;
      }
    } else {
      value = 0;
    }
    if (newObj["sector"] != null) {
      newObj[newObj["sector"]] = value;
    }
    return newObj;
  });

  /*
{ date: '2022/10/18',
    sector: 'эоар',
    y: 5,
    b: 0,
    t: 0,
    uuid: '97e22d53-d019-4100-8dd6-183ffe9b23de',
    location: 'A4:F4',
    datetime: '2022/10/18 00:00:00',
    day: '2022/10/18',
    time: '00:00:00',
    nextdate: '2022/10/19',
    prevdate: '2022/10/17',
    week: '42',
    dayOfWeek: 'ВТ',
    'year-week': '2022-W42',
    'week-dayOfWeek': '42-ВТ',
    'year-week-dayOfWeek': '2022-W42-ВТ',
    'мильпопс': 0,
    nan: 0,
    'эоар': 5,
    'другое': 0,
    'стимулы': 0,
    'мимпатс': 0,
    python: 0,
    'экприроды': 0,
    'истэк': 0,
    'ящерица': 0,
    'бег': 0,
    'зубы': 0,
    'душ': 0,
    'физра': 0,
    'венчур': 0,
    sql: 0,
    'нефтегаз': 0,
    'эконометрия': 0,
    'стрэк': 0,
    ml: 0,
    'бады': 0,
    'прэр': 0,
    'диплом': 0,
    'ресэк': 0,
    'бжд': 0,
    'питание': 0,
    'временные ряды': 0,
    'челюсть': 0,
    'блоки': 0,
    'гигиена': 0,
    web: 0,
    'c++': 0,
    'перхоть': 0,
    'мазь': 0,
    'политеория': 0,
    'алгоритмы': 0,
    'сон': 0,
    'бритье': 0,
    'армия': 0,
    'уборка': 0,
    'соц': 0,
    'работа': 0,
    git: 0,
    wa: 0,
    js: 0,
    html: 0,
    'аренда': 0,
    php: 0,
    css: 0,
    'антивейп': 0,
    'утро': 0,
    'стирка': 0,
    'стрижка': 0,
    'одежда': 0,
    'бюджет': 0,
    'борода': 0,
    'лекарства': 0,
    'вес': 0,
    'дневник': 0,
    'вечер': 0,
    android: 0,
    'ногти': 0 }
   */
  // ==============================================================
  const data = groupAndSumByKeys(bdtasks, [fromrule], agregates); // your array of objects
  // '2022/10/18': { date: '2022/10/18', y: 5, 'стимулы': -10 },

  agregates.map((el) => {
    return `${[el]}`;
  });
  const db = new SQL.Database();

  const sqltable = db.exec(`CREATE TABLE IF NOT EXISTS ${fromrule} (
  ${agregates
    .map((el) => {
      return `${el} ${testSQLiteFormat(data[Object.keys(data)[0]][el])}`;
    })
    .join(", ")}
)`);
  let datasqlinsertable = [];
  const dataarray = Object.values(data);
  for (let datapoint of dataarray) {
    var keytopush = [];
    for (let agr of agregates) {
      keytopush.push(
        typeof datapoint[agr] === "string"
          ? `"${datapoint[agr]}"`
          : datapoint[agr],
      );
    }
    datasqlinsertable.push(`(${keytopush.join(", ")})`);
  }
  datasqlinsertable = datasqlinsertable.join(", ");
  db.exec(`INSERT INTO ${fromrule}(${agregates
    .map((el) => {
      return `${el}`;
    })
    .join(", ")}) VALUES 
    ${datasqlinsertable}
`);
  // console.log(`INSERT INTO ${fromrule}(${agregates.map((el)=>{return `${el}`}).join(', ')}) VALUES
  //     ${datasqlinsertable}
  // `)
  var sqlresult = db.exec(rule);

  if (!(sqlresult["0"] != null)) {
    return [];
  }
  const sqlresultArray = sqlresult["0"].values.map((row) => {
    return sqlresult["0"].columns.reduce((obj, column, index) => {
      obj[column] = row[index];
      return obj;
    }, {});
  });

  for (var i in sqlresultArray) {
    console.log(sqlresultArray[i]);
  }
  return sqlresultArray;
}
// ========================================================================================
// ====================================================================
async function appendCompletedTasksToSheet() {
  const spreadsheetId = readFromProperty('GSHEETS_CONFIG')["spreadsheetId"];
  try {
    const [apptasks, rawData] = await getAllCompletedAndFormattedTasks();
    console.log(`Получено задач из apptasks: ${apptasks.length}`);
    // Создаем множество для уникальных uuid
    const uuidSet = new Set(apptasks.map((task) => task.uuid));
    // Получаем задачи из таблицы
    const bdtasks = await getTr_table();
    console.log(`Получено задач из bdtasks: ${bdtasks.length}`);
    // Находим задачи, которые есть и в apptasks, и в bdtasks по uuid
    // const matches = bdtasks.filter(bdtask => uuidSet.has(bdtask.uuid));
    // Находим задачи, которые есть только в apptasks
    const uniqueApptasks = apptasks.filter(
      (apptask) => !bdtasks.find((bdtask) => bdtask.uuid === apptask.uuid),
    );
    console.log("Число незапушенных задач: " + uniqueApptasks.length);

    if (uniqueApptasks.length > 0) {
      var uniqueApptasks_array = uniqueApptasks.map((obj) => {
        return [
          obj.date,
          obj.sector,
          obj.y,
          obj.b,
          obj.t,
          obj.uuid, // uuid всегда присутствует в apptasks
          obj.comment || "", // comment всегда присутствует в apptasks
          "NEW",
        ];
      });
      // console.log(1)
      var chunks = [];
      if (uniqueApptasks_array.length > 500) {
        var chunkSize = 500;
        for (let i = 0; i < uniqueApptasks_array.length; i += chunkSize) {
          chunks.push(uniqueApptasks_array.slice(i, i + chunkSize));
        }
      } else {
        chunks = [uniqueApptasks_array];
      }
      console.log("Число партий(500) не запушенных задач: " + chunks.length);
      for (let i = 0; i < chunks.length; i++) {
        await GoogleSheets.Spreadsheets.Values.append(
          {
            values: chunks[i],
          },
          spreadsheetId,
          "tr_table!A1",
          { valueInputOption: "USER_ENTERED" },
        );
        console.log(
          `Партия ${i + 1} выполненных задач запушена. Осталось ${chunks.length - i - 1} партий`,
        );
      }
    }
    return rawData
  } catch (error) {
    console.error("Ошибка при добавлении задач:", error);
  }
}
// =========================================================================
// ====================================================================
async function appendRuleBasedTasksToSheet(rule, period) {
  const exceptable_transmutations = {
    push: ["push", "day"],
    day: ["day"],
  };
  //проверка на то, чтобы rule.period=day не происходил во время push
  var period = period ?? "push";
  if (!exceptable_transmutations[rule.period].includes(period)) {
    return;
  }

  const spreadsheetId = readFromProperty('GSHEETS_CONFIG')["spreadsheetId"];
  try {
    const ruletasks = await getRulesBasedCompletedTasks(rule);
    if (ruletasks.length == 0) {
      console.log("Нет задач из Rules для пуша");
      return;
    }

    console.log(`Получено задач из Rules: ${ruletasks.length}`);
    // Создаем множество для уникальных uuid
    // Находим задачи, которые есть и в apptasks, и в bdtasks по uuid
    // const matches = bdtasks.filter(bdtask => uuidSet.has(bdtask.uuid));
    // Находим задачи, которые есть только в apptasks
    console.log("Число незапушенных задач: " + ruletasks.length);

    if (ruletasks.length > 0) {
      var ruletasks_array = ruletasks.map((obj) => {
        return [
          obj.date,
          obj.sector,
          obj.y,
          obj.b,
          obj.t,
          obj.uuid || "",
          obj.comment || "", // comment всегда присутствует в apptasks
          "RULE",
        ];
      });
      // console.log(1)
      var chunks = [];
      if (ruletasks_array.length > 500) {
        var chunkSize = 500;
        for (let i = 0; i < ruletasks_array.length; i += chunkSize) {
          chunks.push(ruletasks_array.slice(i, i + chunkSize));
        }
      } else {
        chunks = [ruletasks_array];
      }
      console.log("Число партий(500) не запушенных задач: " + chunks.length);
      for (let i = 0; i < chunks.length; i++) {
        await GoogleSheets.Spreadsheets.Values.append(
          {
            values: chunks[i],
          },
          spreadsheetId,
          "tr_table!A1",
          { valueInputOption: "USER_ENTERED" },
        );
        console.log(
          `Партия ${i + 1} основанных на правилах задач запушена. Осталось ${chunks.length - i - 1} партий`,
        );
      }
    }
  } catch (error) {
    console.error("Ошибка при добавлении задач:", error);
  }
}
//=========================================================================
//=========================================================================
//=========================================================================
// РЕФАКТОРИНГ ПОЛУЧЕНИЯ ДАННЫХ ИЗ GOOGLE TASKS ДЛЯ СНИЖЕНИЯ РАСХОДА КВОТЫ
//=========================================================================
//=========================================================================
//=========================================================================
function getRawGoogleTasksData() {
  const lists = readFromProperty('GSHEETS_CONFIG')["tasklist_ids"]

  return Promise.all(
    Object.values(lists).map((list) => {
      const tasklistId = list; // Замените на ваш список задач
      return getCompletedTasks_byId(tasklistId).then((allTasks) => {
        // Объединяем все задачи в один список
        const combinedTasks = allTasks.map(obj=>{
          return {
            ...obj,
            task_list_gt_id: tasklistId
          }
        })
        return combinedTasks; // Возвращаем объединенный список завершенных задач
      });
    })
  ).then(tasks=>{
    const fintask=tasks.flat(Infinity)
    console.log(fintask)
    return fintask
  }).catch(error=>{
    console.error('Ошибка при получении задач:', error);
    return []
  })
}