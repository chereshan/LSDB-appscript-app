// ==========================================================================
// миграция бд google sheets в supabase
async function migrateTasksToSupabase(gt_table_sync=undefined) {
  const SUPABASE_CONFIG = readFromProperty('SUPABASE_CONFIG')
  if (gt_table_sync==undefined) {
    console.log('Данные получены небережливо')
  }  
  else {
    console.log('Данные получены бережливо')
  }
  try {
    const { only_gs_tasks_formatted, only_gt_and_both_tasks_formatted } = await getAllFinalFormTasksForSupabase(gt_table_sync);
    const allTasks = [...only_gs_tasks_formatted, ...only_gt_and_both_tasks_formatted];
    
    console.log(`Всего задач для миграции: ${allTasks.length}`);
    console.log(`- из Google Sheets: ${only_gs_tasks_formatted.length}`);
    console.log(`- из Google Tasks: ${only_gt_and_both_tasks_formatted.length}`);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // Начинаем с максимального размера чанка
    const initialChunkSize = 1000;
    let remainingTasks = [...allTasks];

    while (remainingTasks.length > 0) {
      // Для каждой новой порции задач начинаем с максимального размера чанка
      let chunkSize = initialChunkSize;
      let currentBatchTasks = [...remainingTasks];
      remainingTasks = [];

      while (currentBatchTasks.length > 0 && chunkSize >= 1) {
        console.log(`Пробуем отправку с размером чанка: ${chunkSize}`);
        
        // Разбиваем текущую порцию задач на чанки
        const chunks = [];
        for (let i = 0; i < currentBatchTasks.length; i += chunkSize) {
          chunks.push(currentBatchTasks.slice(i, i + chunkSize));
        }

        console.log(`Подготовлено ${chunks.length} чанков размером ${chunkSize}`);
        const failedTasks = [];

        // Пытаемся отправить чанки текущего размера
        for (let i = 0; i < chunks.length; i++) {
          try {
            const response = await UrlFetchApp.fetch(`${SUPABASE_CONFIG.url}/${SUPABASE_CONFIG.table}`, {
              method: 'POST',
              headers: {
                'apikey': SUPABASE_CONFIG.key,
                'Authorization': `Bearer ${SUPABASE_CONFIG.key}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
              },
              muteHttpExceptions: true,
              payload: JSON.stringify(chunks[i])
            });

            const responseCode = response.getResponseCode();
            const responseText = response.getContentText();

            if (responseCode !== 201) {
              console.error(`Ошибка при отправке чанка ${i + 1}/${chunks.length}:`, responseText);
              failedTasks.push(...chunks[i]);
            } else {
              successCount += chunks[i].length;
              console.log(`Успешно отправлен чанк ${i + 1}/${chunks.length} (${chunks[i].length} задач)`);
            }

            // Добавляем задержку между чанками
            if (i < chunks.length - 1) {
              Utilities.sleep(1000);
            }

          } catch (error) {
            console.error(`Ошибка при отправке чанка ${i + 1}:`, error);
            failedTasks.push(...chunks[i]);
          }
        }

        // Если есть неудачные отправки
        if (failedTasks.length > 0) {
          console.log(`Не удалось отправить ${failedTasks.length} задач с размером чанка ${chunkSize}`);
          
          if (chunkSize === 1) {
            // Если размер чанка уже 1, добавляем задачи в список ошибок
            errorCount += failedTasks.length;
            errors.push(...failedTasks.map(task => ({
              task: task,
              error: 'Не удалось отправить даже индивидуально',
              lastAttemptSize: 1
            })));
            currentBatchTasks = []; // Завершаем текущую порцию
          } else {
            // Уменьшаем размер чанка и пробуем снова с теми же задачами
            currentBatchTasks = failedTasks;
            chunkSize = Math.max(Math.floor(chunkSize / 2), 1);
            console.log(`Уменьшаем размер чанка до ${chunkSize}`);
          }
        } else {
          currentBatchTasks = []; // Все задачи успешно отправлены
        }
      }
    }

    // Выводим итоговую статистику
    console.log(`
      Миграция завершена:
      Всего задач: ${allTasks.length}
      Успешно отправлено: ${successCount}
      Ошибок: ${errorCount}
    `);

    if (errors.length > 0) {
      const scriptProperties = PropertiesService.getScriptProperties();
      scriptProperties.setProperty('migration_errors', JSON.stringify(errors));
      console.log('Ошибки сохранены в свойствах скрипта. Используйте getMigrationErrors() для просмотра.');
    }

    return {
      total: allTasks.length,
      success: successCount,
      errors: errorCount,
      errorDetails: errors
    };

  } catch (error) {
    console.error("Ошибка при миграции данных:", error);
    throw error;
  }
}

// Функция для получения сохраненных ошибок миграции
function getMigrationErrors() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const errors = scriptProperties.getProperty("migration_errors");
  return errors ? JSON.parse(errors) : [];
}

// Функция для повторной отправки задач с ошибками
async function retryFailedTasks() {
  const errors = getMigrationErrors();
  if (errors.length === 0) {
    console.log("Нет сохраненных ошибок для повторной отправки");
    return;
  }

  console.log(`Начинаем повторную отправку ${errors.length} задач`);
  return await migrateTasksToSupabase(errors.map((e) => e.task));
}

async function verifyMigration() {
  const SUPABASE_CONFIG = readFromProperty('SUPABASE_CONFIG')
  try {
    const bdtasks = await getTr_table();
    const sheetsCount = bdtasks.length;

    const response = await UrlFetchApp.fetch(
      `${SUPABASE_CONFIG.url}/${SUPABASE_CONFIG.table}?select=count&user_id=eq.${SUPABASE_CONFIG.user_id}`,
      {
        headers: {
          apikey: SUPABASE_CONFIG.key,
          Authorization: `Bearer ${SUPABASE_CONFIG.key}`,
        },
        muteHttpExceptions: true,
      }
    );

    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    console.log(`Ответ сервера при проверке:`, responseText);

    if (responseCode !== 200) {
      throw new Error(
        `Ошибка при получении количества записей. Код: ${responseCode}. Ответ: ${responseText}`
      );
    }

    const supabaseCount = JSON.parse(response.getContentText())[0].count;

    const result = {
      sheetsCount,
      supabaseCount,
      difference: Math.abs(sheetsCount - supabaseCount),
    };

    console.log(`Записей в Google Sheets: ${result.sheetsCount}`);
    console.log(`Записей в Supabase: ${result.supabaseCount}`);
    console.log(`Разница: ${result.difference}`);

    return result;
  } catch (error) {
    console.error("Ошибка при проверке миграции:", error);
    throw error;
  }
}

function runMigration() {
  migrateTasksToSupabase()
    .then(() => verifyMigration())
    .then((result) => {
      console.log("Миграция и проверка завершены");
      console.log("Результаты проверки:", result);
    })
    .catch((error) => console.error("Ошибка:", error));
}
// ===================================================================
// РЕАЛИЗАЦИЯ МИГРАЦИИ ИЗ GOOGLE TASKS APP
// ===================================================================
async function getAllCompletedTasksForSupabase(gt_table_sync=undefined) {
  if (gt_table_sync==undefined) {
    return getRawGoogleTasksData().then(tasks => {
      const formatedData = tasks.map(task => {
        return {
          task_list_gt_id: task["task_list_gt_id"],
          gt_id: task["id"],
          title: task["title"],
          notes: task["notes"],
          completed_at: task["completed"],
          status: task["status"],
          due_at: task["due"],
        }
      });
      return formatedData;
    });
  } else {
    const formatedData = gt_table_sync.map(task => {
      return {
        task_list_gt_id: task["task_list_gt_id"],
        gt_id: task["id"],
        title: task["title"],
        notes: task["notes"],
        completed_at: task["completed"],
        status: task["status"],
        due_at: task["due"],
      }
    });
    return Promise.resolve(formatedData); // Оборачиваем в Promise для консистентности
  }
}
//     id uuid not null,
//     user_id uuid null,
//     task_list_id uuid null,
//     title text null,
//     notes text null,
//     sector text null,
//     comment text null,
//     type text null,
//     value integer null default 0,
//     status text not null,
//     due_at timestamp with time zone null,
//     completed_at timestamp with time zone null,
//     gt_id text null,
//     created_at timestamp with time zone null default now(),
//     updated_at timestamp with time zone null default now(),

function formatTaskForSupabase(task) {
  const SUPABASE_CONFIG = readFromProperty('SUPABASE_CONFIG')
  // { date: '18/10/2022 00:00:00',
  //     sector: 'эоар',
  //     y: '5',
  //     b: '0',
  //     t: '0',
  //     uuid: '97e22d53-d019-4100-8dd6-183ffe9b23de',
  //     location: 'A4:F4' },
  if (task["location"] != null) {
    // console.log("Формируем задачу из gs");
    var final_task = {
      uuid: task["uuid"] ?? null, //вычисляется в функции
      gt_id: null,
      user_id: SUPABASE_CONFIG.user_id,
      task_list_id: null,
      title: null,
      notes: null,
      status: "completed",

      completed_at: task["date"], //привести в формтат iso 8601
      due_at: null, //привести в формтат iso 8601

      type: "other", //вычисляется в функции
      value: 0, //вычисляется в функции
      sector: task["sector"], //вычисляется в функции
      comment: task["comment"] ?? "",
    };
    let taskType, value;
    if (task.y !== "0") {
      taskType = "y";
      value = parseInt(task.y);
    } else if (task.b !== "0") {
      taskType = "b";
      value = parseInt(task.b);
    } else if (task.t !== "0") {
      taskType = "t";
      value = parseInt(task.t);
    } else {
      taskType = "other";
      value = 0;
    }
    final_task["type"] = taskType;
    final_task["value"] = value;
    final_task["completed_at"] = adjustAndFormatDateUTCForSupabase(
      final_task["completed_at"]
    );
    if (task.uuid == null || task.uuid == undefined || task.uuid == "") {
      console.log('генерирую uuid для задачи:'+JSON.stringify(task))
      console.log('location:'+task["location"])
      console.log('date:'+task['date'])
      console.log('sector:'+task['sector'])
      final_task["uuid"] = generateUUIDv5(
        task["location"] + task["date"] + task["sector"]
      );
      console.log('uuid:'+final_task["uuid"])
      console.log('-------------------------------')
    }
    return final_task;
  }
//   console.log("Формируем задачу из gt");
  var final_task = {
    uuid: "nan", //вычисляется в функции
    gt_id: task["gt_id"],
    user_id: SUPABASE_CONFIG.user_id,
    task_list_gt_id: task["task_list_gt_id"],
    task_list_id: null,
    title: task["title"],
    notes: task["notes"],
    status: "completed",

    completed_at: task["completed_at"], //привести в формтат iso 8601
    due_at: task["due_at"], //привести в формтат iso 8601

    type: "other", //вычисляется в функции
    value: 0, //вычисляется в функции
    sector: null, //вычисляется в функции
    comment: "",
  };
  var title = task["title"];
  var notes = task["notes"];
  if (notes == undefined) {
    task["notes"] = null;
  } else {
    var dig = notes
      .toLowerCase()
      .match(/ (\d+?)$|^(\d+?) | (\d+?) |^(\d+?)$/giu);
    dig = +(!dig ? 1 : dig[0].trim());
    var value = notes
      .trim()
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

    if (!["b", "t", "y"].includes(value)) {
      value = "other";
    }
    final_task["type"] = value;
    final_task["value"] = dig;
    sector = !sector ? (value == "b" ? "другое" : "nan") : sector;
    final_task["sector"] = sector.toLowerCase();
    final_task["comment"] = title.toLowerCase() == sector ? "" : title;
  }

  final_task["completed_at"] = adjustAndFormatDateUTCForSupabase(
    final_task["completed_at"]
  );
  final_task["due_at"] = final_task["due_at"]
    ? adjustAndFormatDateUTCForSupabase(final_task["due_at"])
    : null;

  final_task["uuid"] = generateUUIDv5(
    task["gt_id"]
  );
  final_task["task_list_id"] = generateUUIDv5(
    final_task["task_list_gt_id"]
  );
  delete final_task["task_list_gt_id"];
  return final_task;
}

function getAllCompletedAndFormattedTasksForSupabase(gt_table_sync=undefined) {
  return getAllCompletedTasksForSupabase(gt_table_sync).then((alltasks) => {
    var tasks = alltasks.flat(Infinity);
    var formattedtasks = [];
    for (var i = 0; i < tasks.length; i++) {
      var ftask = formatTaskForSupabase(tasks[i]);
    //   console.log(ftask);
      formattedtasks.push(ftask);
    }
    formattedtasks = formattedtasks.filter((val) => {
      return val != undefined;
    });
    console.log(`Выполненных задач в app:${formattedtasks.length}`);
    return formattedtasks;
  });
}

function adjustAndFormatDateUTCForSupabase(inputDate) {
  // Проверяем, в каком формате пришла дата
  if (inputDate.includes("T")) {
    // Если дата уже в ISO формате, возвращаем как есть
    return inputDate;
  }
  // Парсим дату из формата "DD/MM/YYYY HH:mm:ss"
  const regex = /(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{1,2}):(\d{1,2})/;
  const match = inputDate.match(regex);

  const [day, month, year] = [
    parseInt(match[1].length == 2 ? match[1] : "0" + match[1]),
    parseInt(match[2].length == 2 ? match[2] : "0" + match[2]),
    parseInt(match[3]),
  ];
  const [hours, minutes, seconds] = [
    parseInt(match[4].length == 2 ? match[4] : "0" + match[4]),
    parseInt(match[5].length == 2 ? match[5] : "0" + match[5]),
    parseInt(match[6].length == 2 ? match[6] : "0" + match[6]),
  ];

  // Создаем дату в локальной временной зоне
  const localDate = new Date(
    parseInt(year),
    parseInt(month) - 1, // месяцы в JS начинаются с 0
    parseInt(day),
    parseInt(hours),
    parseInt(minutes),
    parseInt(seconds)
  );

  // Преобразуем в UTC (отнимаем 7 часов)
  const utcDate = new Date(localDate.getTime());

  // Возвращаем в формате ISO UTC
  return utcDate.toISOString(); // Например: "2025-01-09T16:57:32.000Z"
}
// ===================================================================
// РЕАЛИЗАЦИЯ МИГРАЦИИ ИЗ GOOGLE SHEETS + ПОЛНАЯ МИГРАЦИЯ С АНТИКОЛЛИЗИЕЙ
// ===================================================================
async function getAllFinalFormTasksForSupabase(gt_table_sync=undefined) {
  let gs_tasks = await getTr_table();

  let gs_uuids = gs_tasks
    .filter((val) => {
      let uuid = val.uuid;
      if (uuid instanceof String) {
        uuid = uuid.trim();
      }
      if (uuid != null && uuid != undefined && uuid != "") return true;
      return false;
    })
    .map((val) => val.uuid);

  let gt_tasks = await getAllCompletedAndFormattedTasksForSupabase(gt_table_sync);
  gt_uuids = gt_tasks.map((val) => {
    let uuid = val.uuid;
    if (uuid instanceof String) {
      uuid = uuid.trim();
    }
    if (uuid != null && uuid != undefined && uuid != "") return uuid;
  });


  let both_gt_gs_uuids = gs_uuids.filter((val) => gt_uuids.includes(val));
  let only_gt_uuids = gt_uuids.filter((val) => !gs_uuids.includes(val));
  let only_gs_uuids = gs_uuids.filter((val) => !gt_uuids.includes(val));

  let gs_tasks_without_uuids = gs_tasks.filter((val) => {
    let uuid = val.uuid;
    if (uuid instanceof String) {
      uuid = uuid.trim();
    }
    if (uuid == null || uuid == undefined || uuid == "") return true;
    return false;
  });

  console.log(`Всего общих uuid: ${both_gt_gs_uuids.length}`);
  console.log(`Всего uuid из gt, не в gs: ${only_gt_uuids.length}`);
  console.log(`Всего uuid из gs, не в gt: ${only_gs_uuids.length}`);
  console.log(`Всего задач из gs без uuid: ${gs_tasks_without_uuids.length}`);

  let only_gs_tasks=gs_tasks.filter((val)=>only_gs_uuids.includes(val.uuid)).concat(gs_tasks_without_uuids)
  let only_gt_and_both_uuids=both_gt_gs_uuids.concat(only_gt_uuids)
  let only_gt_and_both_tasks=gt_tasks.filter((val)=>only_gt_and_both_uuids.includes(val.uuid))

  let only_gs_tasks_formatted=only_gs_tasks.map((val)=>{
    val=formatTaskForSupabase(val)
    return val
  })
//   уже отформатированные
  let only_gt_and_both_tasks_formatted=only_gt_and_both_tasks
//   .map((val)=>{
//     val=formatTaskForSupabase(val)
//     return val
//   })

  let all_tasks=only_gt_and_both_tasks_formatted.concat(only_gs_tasks_formatted)
//   for (let i = 0; i < all_tasks.length; i++) {
//     console.log(all_tasks[i]);
//   }
  console.log(`Всего задач: ${all_tasks.length}`);
  console.log(`Всего отформатированных как GT: ${only_gt_and_both_tasks_formatted.length}`);
  console.log(`Всего отформатированных как GS: ${only_gs_tasks_formatted.length}`);
  // Rename uuid to id in both task arrays
  only_gs_tasks_formatted = only_gs_tasks_formatted.map(task => {
    const { uuid, ...rest } = task;
    return { id: uuid, ...rest };
  });

  only_gt_and_both_tasks_formatted = only_gt_and_both_tasks_formatted.map(task => {
    const { uuid, ...rest } = task;
    return { id: uuid, ...rest };
  });
  only_gs_tasks_formatted=only_gs_tasks_formatted.map(task => normalizeTaskforSupabase(task))
  only_gt_and_both_tasks_formatted=only_gt_and_both_tasks_formatted.map(task => normalizeTaskforSupabase(task))
  return { only_gs_tasks_formatted, only_gt_and_both_tasks_formatted };
}
// ===================================================================
// РЕАЛИЗАЦИЯ ПУША В SUPABASE
// ===================================================================
// Добавьте эту функцию для проверки структуры объектов
function normalizeTaskforSupabase(task) {
    const requiredKeys = [
      'id',
      'user_id',
      'task_list_id',
      'title',
      'notes',
      'sector',
      'comment',
      'type',
      'value',
      'status',
      'due_at',
      'completed_at',
      'gt_id'
      // created_at и updated_at можно опустить, они заполнятся автоматически
    ];
    
    const normalized = {};
    requiredKeys.forEach(key => {
      normalized[key] = task[key] ?? null;  // используем ?? для сохранения пустых строк
    });
    
    return normalized;
  }

//   объясни ошибку supabase {"code":"PGRST102","details":null,"hint":null,"message":"All object keys must match"}
//   Ошибка "All object keys must match" от PostgREST (который использует Supabase) означает, что при массовой вставке (bulk insert) все объекты в массиве должны иметь одинаковый набор ключей.
//   Например, это вызовет ошибку:
//   [
//     {
//       id: "uuid1",
//       status: "completed",
//       title: "Task 1"
//     },
//     {
//       id: "uuid2",
//       status: "completed",
//       notes: "Some notes"  // разные ключи - title vs notes
//     }
//   ]
//   А это будет работать:
//   [
//     {
//       id: "uuid1",
//       status: "completed",
//       title: "Task 1",
//       notes: null
//     },
//     {
//       id: "uuid2",
//       status: "completed",
//       title: null,
//       notes: "Some notes"
//     }
//   ]
//   В вашем случае ошибка возникает потому, что задачи из разных источников (Google Sheets и Google Tasks) имеют разный набор полей. Чтобы исправить это, нужно нормализовать все объекты перед отправкой, убедившись, что они имеют одинаковый набор ключей (даже если значения будут null).
// Вы можете использовать функцию нормализации:
// function normalizeTask(task) {
//     const requiredKeys = [
//       'id',
//       'user_id',
//       'task_list_id',
//       'title',
//       'notes',
//       'sector',
//       'comment',
//       'type',
//       'value',
//       'status',
//       'due_at',
//       'completed_at',
//       'gt_id'
//       // created_at и updated_at можно опустить, они заполнятся автоматически
//     ];
    
//     const normalized = {};
//     requiredKeys.forEach(key => {
//       normalized[key] = task[key] ?? null;  // используем ?? для сохранения пустых строк
//     });
    
//     return normalized;
//   }
  
//   // Применяем нормализацию перед отправкой:
//   const normalizedTasks = tasks.map(task => normalizeTask(task));