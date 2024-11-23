//=========================================================================
//=========================================================================
// function listTaskLists() {
//   // Получаем список списков задач
//   var taskLists = GoogleTasks.Tasklists.list().items;

//   if (taskLists && taskLists.length > 0) {
//     for (var i = 0; i < taskLists.length; i++) {
//       var taskList = taskLists[i];
//       console.log('Task List Title: ' + taskList.title + ', ID: ' + taskList.id);
//     }
//   } else {
//     console.log('No task lists found.');
//   }
// }
//=========================================================================
// dev-функции
//=========================================================================

async function f() {
  try {
    const apptasks = await getAllCompletedAndFormattedTasks();
    console.log(`Получено задач из apptasks: ${apptasks.length}`);

    // Создаем множество для уникальных комбинаций date, sector, y, t, b
    const detailedTasksSet = new Set(
      apptasks.map(
        (task) => `${task.date}:${task.sector}:${task.y}:${task.t}:${task.b}`,
      ),
    );

    // Получаем задачи из таблицы
    const bdtasks = await getTr_table();
    console.log(`Получено задач из bdtasks: ${bdtasks.length}`);

    // Находим задачи, которые есть и в apptasks, и в bdtasks по всем атрибутам
    const matches = bdtasks.filter((bdtask) =>
      detailedTasksSet.has(
        `${bdtask.date}:${bdtask.sector}:${bdtask.y}:${bdtask.t}:${bdtask.b}`,
      ),
    );

    // Для каждого совпадения выполняем перезапись строки в таблице
    const updatePromises = matches.map((match) => {
      const detailedKey = `${match.date}:${match.sector}:${match.y}:${match.t}:${match.b}`;
      const apptask = apptasks.find(
        (apptask) =>
          `${apptask.date}:${apptask.sector}:${apptask.y}:${apptask.t}:${apptask.b}` ===
          detailedKey,
      );

      // Формируем новые значения для обновления, используя данные из apptasks
      const newValues = [
        [
          apptask.date,
          apptask.sector,
          apptask.y,
          apptask.b,
          apptask.t,
          apptask.uuid, // uuid всегда присутствует в apptasks
          apptask.comment || "", // comment всегда присутствует в apptasks
          "UPDATED",
        ],
      ];
      console.log(`новые значения:${newValues}`);
      // Используем поле location из bdtasks для определения диапазона
      const range = match.location.replace("F", "H"); // Предполагается, что match.location содержит правильный формат диапазона для Google Sheets API

      // Выводим локацию и содержимое заменяемой строки до замены
      console.log(
        `Локация: ${range}. Содержимое заменяемой строки до замены: ${JSON.stringify(match)}`,
      );

      // Вызываем функцию для перезаписи задачи с повторными попытками
      return rewriteTaskWithRetry(range, newValues)
        .then((result) => {
          // Выводим содержимое строки после замены
          console.log(
            `Содержимое строки после замены: ${JSON.stringify(result)}`,
          );
          return { range, result };
        })
        .catch((error) => {
          // Обрабатываем ошибку, если она произошла
          console.error(
            `Ошибка при обновлении задачи в локации ${range}:`,
            error,
          );
          console.error(match);
          console.error(newValues[0]);
          // Возвращаем объект с информацией об ошибке, включая содержимое заменяемого и замещающего элементов
          return {
            range,
            error,
            originalTask: match,
            newValues: newValues[0],
          };
        });
    });

    // Ожидаем завершения всех операций обновления
    const results = await Promise.all(updatePromises);
    console.log("Все обновления успешно выполнены.");

    // Фильтруем результаты, чтобы отделить успешные обновления от ошибок
    const successfulUpdates = results.filter((result) => !result.error);
    const errors = results.filter((result) => result.error);

    // Выводим информацию об ошибках
    if (errors.length > 0) {
      console.error("Ошибки при обновлении задач:");
      errors.forEach((errorResult) => {
        console.error(`Локация: ${errorResult.range}`);
        console.error(
          `Содержимое заменяемой строки: ${JSON.stringify(errorResult.originalTask)}`,
        );
        console.error(
          `Содержимое замещающей строки: ${JSON.stringify(errorResult.newValues)}`,
        );
        console.error(`Ошибка: ${errorResult.error.message}`);
      });
    }

    // Возвращаем успешные результаты
    return successfulUpdates;
  } catch (error) {
    console.error("Ошибка при обработке задач:", error);
  }
}


// ==========================================================================
//работающий код для запросов к базе данных
//надо написать рабочий api для взаимодействия с БД
// var query = 'SELECT * FROM tr_table FORMAT JSON';
function queryClickHouse(query) {
  var clickHouseEndpoint = "https://msc-f3835d44.us-east-1.aws.myscale.com:443";
  var query = query;
  var options = {
    method: "post",
    headers: {
      "X-ClickHouse-HTTP-Method-Override": "GET",
      "X-ClickHouse-User": "chereshan_org_default",
      "X-ClickHouse-Key": "passwd_fdVESALIhh9RTX",
    },
    payload: query,
    muteHttpExceptions: true,
  };
  var response = UrlFetchApp.fetch(clickHouseEndpoint, options);
  console.log(response);
  if (response.getResponseCode() === 200) {
    var results = JSON.parse(response.getContentText());
    // Обработать результаты
    Logger.log(results);
  } else {
    // Обработать ошибку
    Logger.log("Error: " + response.getContentText());
  }
}