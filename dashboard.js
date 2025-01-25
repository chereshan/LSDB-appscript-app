function doGet() {
  var template = HtmlService.createTemplateFromFile('DASHBOARD');
  let bdtasks_client = getTr_table2();
  template.bdtasks_client = bdtasks_client;
  template.environment = 'appscript'
  var html = template.evaluate();
  var output = HtmlService.createHtmlOutput(html);
  output.addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return output;
}

  //   $(function(){
  //     $tr_table=$('#tr_table')
  //     $tr_table.DataTable({
  //       "columns": [
  //         {'data':'date'},
  //         {'data':'sector'},
  //         {'data':'y'},
  //         {'data':'b'},
  //         {'data':'t'},
  //     ],
  //     "data": bdtasks
  //   });
  // })
  // html.append("<canvas id='myChart' width='400' height='200'></canvas>");
  //html.append("<script>var ctx = document.getElementById('myChart').getContext('2d');var chart = new Chart(ctx, {type: 'bar',data: {labels: ['January', 'February', 'March'],datasets: [{label: 'Series A',data: [10, 20, 30]}]},options: {}});</script>");

function f(){
  getTr_table().then((bdtasks)=>{
    console.log(`Получено задач из bdtasks: ${bdtasks.length}`);
    console.log(bdtasks)
  }).catch(error => {
       console.error('Ошибка при обработке задач:', error);
     });
}

// function f() {
//   getAllCompletedAndFormattedTasks()
//     .then(apptasks => {
//       console.log(`Получено задач из apptasks: ${apptasks.length}`);
//       // Создаем множество для уникальных комбинаций date, sector, y, t, b
//       const detailedTasksSet = new Set(apptasks.map(task => {
//         return `${task.date}:${task.sector}:${task.y}:${task.t}:${task.b}`;
//       }));

//       // Получаем задачи из таблицы
//       return getTr_table().then(bdtasks => {
//         console.log(`Получено задач из bdtasks: ${bdtasks.length}`);

//         // Находим задачи, которые есть и в apptasks, и в bdtasks по всем атрибутам
//         const matches = bdtasks.filter(bdtask => {
//           const detailedKey = `${bdtask.date}:${bdtask.sector}:${bdtask.y}:${bdtask.t}:${bdtask.b}`;
//           return detailedTasksSet.has(detailedKey);
//         });

//         // Добавляем локацию из bdtasks в объекты apptasks
//         const matchedTasksWithLocation = matches.map(match => {
//           const detailedKey = `${match.date}:${match.sector}:${match.y}:${match.t}:${match.b}`; // Определяем detailedKey внутри map
//           const apptask = apptasks.find(apptask => {
//             return `${apptask.date}:${apptask.sector}:${apptask.y}:${apptask.t}:${apptask.b}` === detailedKey;
//           });
//           return { ...apptask, location: match.location }; // Предполагается, что match содержит location
//         });

//         console.log(`Совпадений по всем атрибутам: ${matchedTasksWithLocation.length}`);
//         console.log('Совпадающие задачи с локацией:');
//         console.log(matchedTasksWithLocation);
//         return matchedTasksWithLocation;
//       });
//     })
//     .catch(error => {
//       console.error('Ошибка при обработке задач:', error);
//     });
// }
function getTr_table2(byrange = false) {
  var spreadsheetId = readFromProperty('GSHEETS_CONFIG')["spreadsheetId"];
  var rangeName = 'tr_table';
  
  var options = {
    'method': 'GET',
    'headers': {
      'Authorization': 'Bearer ' + ScriptApp.getOAuthToken()
    },
    'muteHttpExceptions': true
  };
  
  var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheetId + '/values/' + rangeName;
  
  var response = UrlFetchApp.fetch(url, options);
  var data = JSON.parse(response.getContentText());
  
  var values = data.values;
  
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
            value: cellValue
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
        rowObject.location = locationStart + ':' + locationEnd;
        results.push(rowObject);
      }
    }
  }

   console.log(results);
  // Возвращаем массив результатов
  return results;
}