/**
 * 微博爬虫工具 - Content Script
 * 自动注入到微博页面右下角
 */

(function() {
  'use strict';

  if (window.__WEIBO_SCRAPER_LOADED__) return;
  window.__WEIBO_SCRAPER_LOADED__ = true;

  console.log('[微博爬虫] Content Script 加载中...');

  // 注入HTML
  var crawlerHTML = 
    '<div id="lyder-weibo-scraper-main" class="expanded">' +
      '<div class="crawler-header">' +
        '<div class="crawler-title">微博博主主页爬取工具</div>' +
        '<div class="crawler-toggle">▼</div>' +
      '</div>' +
      '<div class="crawler-body">' +
        '<input type="text" class="url-input" id="lyder-weibo-url" placeholder="输入微博URL" value="https://weibo.com/u/6251584258">' +
        '<div class="crawler-stats">' +
          '<span>已爬取: <span id="lyder-crawled-count" class="stats-value">0</span> 条</span>' +
          '<span>状态: <span class="status-indicator status-ready"></span><span id="lyder-crawler-status">就绪</span></span>' +
        '</div>' +
        '<div class="progress-container">' +
          '<div class="progress-bar" id="lyder-progress-bar"></div>' +
        '</div>' +
        '<div class="crawler-buttons">' +
          '<button class="crawler-btn btn-start" id="lyder-start-crawl">▶ 开始爬取</button>' +
          '<button class="crawler-btn btn-pause" id="lyder-pause-resume" disabled>⏸ 暂停</button>' +
          '<button class="crawler-btn btn-download" id="lyder-download-csv" disabled>⭳ 下载CSV</button>' +
        '</div>' +
        '<div class="crawler-log" id="lyder-crawler-log"></div>' +
      '</div>' +
      '<div class="watermark">Created by Lliulifeili | v2.0</div>' +
    '</div>';

  document.body.insertAdjacentHTML('beforeend', crawlerHTML);

  // 等待DOM渲染
  setTimeout(initScraper, 500);

  function initScraper() {
    var crawler = document.getElementById('lyder-weibo-scraper-main');
    if (!crawler) {
      console.error('[微博爬虫] 注入失败');
      return;
    }

    console.log('[微博爬虫] UI注入成功');

    // 元素引用
    var elements = {
      header: document.querySelector('.crawler-header'),
      body: document.querySelector('.crawler-body'),
      urlInput: document.getElementById('lyder-weibo-url'),
      startBtn: document.getElementById('lyder-start-crawl'),
      pauseBtn: document.getElementById('lyder-pause-resume'),
      downloadBtn: document.getElementById('lyder-download-csv'),
      logArea: document.getElementById('lyder-crawler-log'),
      count: document.getElementById('lyder-crawled-count'),
      progressBar: document.getElementById('lyder-progress-bar'),
      status: document.getElementById('lyder-crawler-status'),
      statusIndicator: document.querySelector('.status-indicator')
    };

    // 爬虫状态
    var state = {
      isRunning: false,
      isPaused: false,
      data: [],
      currentPage: 1,
      sinceId: '',
      uid: '',
      fetchedUrls: [],
      fetchedSinceIds: [],
      duplicateCount: 0
    };

    // 日志
    function log(message, type) {
      var entry = document.createElement('div');
      entry.className = 'log-entry log-' + (type || 'info');
      var time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      entry.innerHTML = '<span class="log-time">[' + time + ']</span> ' + message;
      elements.logArea.appendChild(entry);
      elements.logArea.scrollTop = elements.logArea.scrollHeight;
      console.log('[微博爬虫] ' + message);
    }

    // 更新状态
    function updateStatus(status, type) {
      elements.status.textContent = status;
      elements.statusIndicator.className = 'status-indicator status-' + type;
    }

    // 更新进度
    function updateProgress(percent) {
      elements.progressBar.style.width = percent + '%';
    }

    // 更新数量
    function updateCount(count) {
      elements.count.textContent = count;
    }

    // 展开/收起
    elements.header.addEventListener('click', function() {
      crawler.classList.toggle('expanded');
    });

    // 从URL提取UID
    function extractUid(url) {
      var match = url.match(/weibo\.com\/u\/(\d+)/);
      if (match) return match[1];
      var match2 = url.match(/(\d{8,})/);
      if (match2) return match2[1];
      return '';
    }

    // 构建API URL
    function buildApiUrl() {
      var url = 'https://weibo.com/ajax/statuses/mymblog?uid=' + state.uid + '&page=' + state.currentPage + '&feature=0';
      if (state.currentPage > 1 && state.sinceId) {
        url += '&since_id=' + state.sinceId;
      }
      return url;
    }

    // 日期格式转换
    function convertDate(weiboDate) {
      if (!weiboDate) return '';
      try {
        var monthMap = {
          'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
          'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
          'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
        };
        var parts = weiboDate.split(' ');
        if (parts.length >= 6) {
          var month = monthMap[parts[1]] || '01';
          var day = ('0' + parts[2]).slice(-2);
          var time = parts[3];
          var year = parts[5];
          return year + '-' + month + '-' + day + ' ' + time;
        }
        return weiboDate;
      } catch (e) {
        return weiboDate;
      }
    }

    // 点击翻页按钮
    async function clickNextPage() {
      return new Promise(function(resolve) {
        var nextButton = null;
        var allDivs = document.querySelectorAll('div[class*="nextPage"]');
        for (var i = 0; i < allDivs.length; i++) {
          var div = allDivs[i];
          var classes = div.className || '';
          if (classes.indexOf('woo-box-flex') !== -1 &&
              classes.indexOf('woo-box-alignCenter') !== -1 &&
              classes.indexOf('woo-box-justifyCenter') !== -1) {
            nextButton = div;
            break;
          }
        }

        if (!nextButton) {
          var attrButtons = document.querySelectorAll('div[class*="_nextPage_"]');
          for (var j = 0; j < attrButtons.length; j++) {
            var btn = attrButtons[j];
            if ((btn.className || '').indexOf('woo-box-flex') !== -1) {
              nextButton = btn;
              break;
            }
          }
        }

        if (nextButton) {
          try {
            nextButton.click();
            resolve({ success: true });
          } catch (e) {
            try {
              var evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
              nextButton.dispatchEvent(evt);
              resolve({ success: true });
            } catch (e2) {
              resolve({ success: false });
            }
          }
        } else {
          resolve({ success: false });
        }
      });
    }

    // 爬取循环
    async function scrapeLoop() {
      var maxDuplicate = 2;
      log('📄 开始爬取...', 'info');

      while (state.isRunning) {
        if (state.isPaused) {
          await sleep(200);
          continue;
        }

        var apiUrl = buildApiUrl();

        // URL去重
        if (state.fetchedUrls.indexOf(apiUrl) !== -1) {
          state.duplicateCount++;
          log('🔄 URL重复 (' + state.duplicateCount + '/' + maxDuplicate + ')', 'warn');
          if (state.duplicateCount >= maxDuplicate) {
            log('🛑 检测到循环，停止', 'warn');
            break;
          }
        } else {
          state.duplicateCount = 0;
          state.fetchedUrls.push(apiUrl);
        }

        // 请求API
        try {
          var result = await fetch(apiUrl);
          var data = await result.json();

          if (data.ok !== 1) {
            throw new Error(data.errmsg || 'API错误');
          }

          var posts = (data.data.list || []).map(function(item) {
            return {
              id: item.id,
              user_id: (item.user && item.user.id) || '',
              user_name: (item.user && item.user.screen_name) || '',
              created_at: convertDate(item.created_at),
              source: item.source || '',
              content: (item.text_raw || '').replace(/"/g, '""').replace(/\n/g, ' '),
              reposts: item.reposts_count || 0,
              comments: item.comments_count || 0,
              attitudes: item.attitudes_count || 0
            };
          });

          if (posts.length > 0) {
            // 去重
            var existingIds = {};
            state.data.forEach(function(d) { existingIds[d.id] = true; });
            var newPosts = posts.filter(function(p) { return !existingIds[p.id]; });

            if (newPosts.length > 0) {
              state.data = state.data.concat(newPosts);
              updateCount(state.data.length);
              log('✅ 第' + state.currentPage + '页: ' + newPosts.length + '条 (总计:' + state.data.length + ')', 'success');
            }

            // 获取下一页since_id
            if (data.data.next_cursor) {
              state.sinceId = data.data.next_cursor;
            } else if (data.data.list && data.data.list.length > 0) {
              state.sinceId = data.data.list[data.data.list.length - 1].id;
            }

            if (state.sinceId) {
              log('🔗 since_id: ' + state.sinceId, 'info');
            } else {
              log('🔚 无更多页面', 'info');
              break;
            }

            if (posts.length < 10 && newPosts.length === 0) {
              log('📊 数据量过少，结束', 'info');
              break;
            }
          } else {
            log('📭 无数据', 'info');
            break;
          }
        } catch (error) {
          log('⚠️ 请求失败: ' + error.message, 'error');
          state.duplicateCount++;
          if (state.duplicateCount >= maxDuplicate) {
            log('🛑 连续失败，停止', 'error');
            break;
          }
        }

        // 点击翻页
        var clickResult = await clickNextPage();
        if (clickResult.success) {
          log('🔄 已点击翻页', 'info');
          await sleep(2000 + Math.random() * 1000);
          state.currentPage++;
        }

        await sleep(1000 + Math.random() * 1500);
      }

      finishScrape();
    }

    // 完成爬取
    function finishScrape() {
      state.isRunning = false;
      updateUIState(false);

      if (state.data.length > 0) {
        updateStatus('完成', 'ready');
        log('🎉 共爬取 ' + state.data.length + ' 条！', 'success');
        updateProgress(100);
        elements.downloadBtn.disabled = false;
      } else {
        updateStatus('无数据', 'error');
        log('❌ 未爬取到数据', 'error');
      }
    }

    // 更新UI状态
    function updateUIState(running) {
      elements.startBtn.disabled = running;
      elements.pauseBtn.disabled = !running;
      elements.urlInput.disabled = running;
    }

    // 下载CSV
    function downloadCSV() {
      if (state.data.length === 0) {
        log('❌ 无数据可下载', 'error');
        return;
      }

      // 序号, 用户ID, 用户昵称, 发帖时间, 发帖来源, 帖子内容, 转发量, 评论量, 点赞量
      var headers = ['序号', '用户ID', '用户昵称', '发帖时间', '发帖来源', '帖子内容', '转发量', '评论量', '点赞量'];
      var rows = state.data.map(function(item, index) {
        return [
          index + 1,
          item.user_id,
          '"' + item.user_name + '"',
          item.created_at,
          '"' + item.source + '"',
          '"' + item.content + '"',
          item.reposts,
          item.comments,
          item.attitudes
        ].join(',');
      });

      var csv = [headers.join(','), rows.join('\n')].join('\n');
      var BOM = '\uFEFF';
      var blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });

      var now = new Date();
      var pad = function(n) { return ('0' + n).slice(-2); };
      var timestamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '_' + 
                     pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
      var filename = 'weibo_' + state.uid + '_' + timestamp + '.csv';

      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      log('📥 已下载: ' + filename, 'success');
    }

    // 工具函数
    function sleep(ms) {
      return new Promise(function(resolve) { setTimeout(resolve, ms); });
    }

    // 开始爬取按钮
    elements.startBtn.addEventListener('click', function() {
      var url = elements.urlInput.value.trim();
      var uid = extractUid(url);

      if (!uid) {
        log('❌ 无法解析UID，请检查URL', 'error');
        return;
      }

      state.uid = uid;
      state.isRunning = true;
      state.isPaused = false;
      state.data = [];
      state.currentPage = 1;
      state.sinceId = '';
      state.fetchedUrls = [];
      state.fetchedSinceIds = [];
      state.duplicateCount = 0;

      updateUIState(true);
      updateStatus('爬取中...', 'active');
      updateProgress(0);
      updateCount(0);
      log('🚀 开始爬取 UID: ' + uid, 'info');

      scrapeLoop();
    });

    // 暂停按钮
    elements.pauseBtn.addEventListener('click', function() {
      state.isPaused = !state.isPaused;
      if (state.isPaused) {
        elements.pauseBtn.textContent = '▶ 继续';
        updateStatus('已暂停', 'paused');
        log('⏸ 已暂停', 'warning');
      } else {
        elements.pauseBtn.textContent = '⏸ 暂停';
        updateStatus('爬取中...', 'active');
        log('▶ 继续爬取', 'info');
      }
    });

    // 下载按钮
    elements.downloadBtn.addEventListener('click', downloadCSV);

    // 自动检测当前URL
    if (window.location.href.indexOf('weibo.com') !== -1) {
      elements.urlInput.value = window.location.href;
      log('🔍 已检测当前页面', 'info');
    }

    log('✅ 微博爬虫工具已就绪', 'success');
  }

})();
