// ⚠️ 重要提示：此 Worker 需要绑定一个名为 R2_BUCKET 的 R2 存储桶。
// 如果未绑定 R2 存储桶，Worker 将无法正常工作。

// 添加一个检查确保 R2_BUCKET 已定义
if (typeof R2_BUCKET === 'undefined') {
  console.error('R2_BUCKET is not defined. Please bind an R2 bucket to this Worker.');
}

const SHARE_LINKS_KEY = 'admin:share_links';
const DELETED_TODOS_KEY = 'system:deleted_todos';

// --- 核心请求处理入口 ---

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

// --- 辅助函数 ---

const getKvKey = (userId) => `todos:${userId}`;

function getDisplayName(userId) {
  if (userId === 'admin') return 'yc';
  return userId;
}

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  
  // Beijing is UTC+8
  const beijingOffset = 8 * 60 * 60 * 1000;
  const beijingTime = new Date(d.getTime() + beijingOffset);
  
  const year = beijingTime.getUTCFullYear();
  const month = beijingTime.getUTCMonth() + 1;
  const day = beijingTime.getUTCDate();
  const hours = beijingTime.getUTCHours();
  const minutes = beijingTime.getUTCMinutes();
  
  const paddedMinutes = minutes < 10 ? '0' + minutes : minutes;
  return `${year}年${month}月${day}日 ${hours}点${paddedMinutes}分`;
}

// --- R2 存储函数 ---

async function loadTodos(key) {
  try {
    const r2Object = await R2_BUCKET.get(key);
    if (r2Object === null) return [];
    return await r2Object.json();
  } catch (error) {
    console.error(`Error loading or parsing todos for key ${key}:`, error);
    return [];
  }
}

async function saveTodos(key, todos) {
  await R2_BUCKET.put(key, JSON.stringify(todos));
}

async function loadShareLinks() {
  try {
    const r2Object = await R2_BUCKET.get(SHARE_LINKS_KEY);
    if (r2Object === null) return {};
    return await r2Object.json();
  } catch (error) {
    console.error("Error loading share links:", error);
    return {};
  }
}

async function saveShareLinks(links) {
  await R2_BUCKET.put(SHARE_LINKS_KEY, JSON.stringify(links));
}

async function loadDeletedTodos() {
  try {
    const r2Object = await R2_BUCKET.get(DELETED_TODOS_KEY);
    if (r2Object === null) return [];
    return await r2Object.json();
  } catch (error) {
    console.error("Error loading deleted todos:", error);
    return [];
  }
}

async function saveDeletedTodos(todos) {
  await R2_BUCKET.put(DELETED_TODOS_KEY, JSON.stringify(todos));
}

async function getAllUsersTodos() {
  const listResponse = await R2_BUCKET.list({ prefix: 'todos:' });
  const keys = listResponse.objects.map(k => k.key);
  
  let allTodos = [];
  for (const key of keys) {
    const ownerId = key.substring(6);
    const userTodos = await loadTodos(key);
    allTodos.push(...userTodos.map(todo => ({ ...todo, ownerId: ownerId })));
  }
  allTodos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return allTodos;
}


// --- 静态资源处理 ---

// 由于 Worker 本身无法直接 serve 静态文件，我们需要将文件内容作为字符串常量
// 在实际部署中，这些内容应该通过构建过程或从其他地方获取
const STATIC_FILES = {
  '/': () => renderMasterViewHtml, // 主页仍然使用动态渲染
  '/index.html': () => `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>全局待办事项清单</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="p-4 md:p-8">
  <div class="container mx-auto max-w-4xl space-y-10">
    
    <h1 class="text-4xl font-bold text-center text-gray-900">全局待办事项清单</h1>

    <!-- 添加事项的表单 -->
    <div class="bg-white p-6 rounded-xl shadow-lg">
      <h2 class="text-2xl font-semibold mb-4 text-gray-800">添加新事项</h2>
      <form action="/add_todo" method="POST">
        <input type="hidden" name="creatorId" value="admin">
        <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
          <input type="text" name="text" placeholder="输入新的待办事项..." required class="md:col-span-3 p-3 border rounded-lg">
          
          <div class="md:col-span-2 p-3 border rounded-lg bg-gray-50">
            <h3 class="text-base font-semibold mb-2 text-gray-700">指派给 (可多选)</h3>
            <div class="space-y-2 max-h-24 overflow-y-auto">
                <label class="flex items-center space-x-2 font-normal">
                    <input type="checkbox" name="userIds" value="public" class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50">
                    <span>Public (无指定用户)</span>
                </label>
                <!-- 用户选项将在这里动态插入 -->
            </div>
          </div>
        </div>
        <button type="submit" class="mt-4 w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg">添加</button>
      </form>
    </div>

    <!-- 待办事项列表 -->
    <div class="bg-white p-6 rounded-xl shadow-lg">
      <h2 class="text-2xl font-semibold mb-4 text-gray-800">所有事项</h2>
      <ul id="all-todos-list" class="space-y-3">
        <p class="text-center text-gray-500 py-10">无任何待办事项。</p>
      </ul>
    </div>

    <!-- 用户管理区域 -->
    <div class="bg-white p-6 rounded-xl shadow-lg">
      <h2 class="text-2xl font-semibold mb-4 text-gray-800">用户管理</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <h3 class="text-lg font-semibold mb-2">新增用户</h3>
          <form action="/add_user" method="POST" class="flex space-x-2">
            <input type="text" name="username" placeholder="新用户名..." required class="flex-grow p-2 border rounded-lg">
            <button type="submit" class="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-lg">创建</button>
          </form>
        </div>
        <div>
          <h3 class="text-lg font-semibold mb-2">现有用户 (<span id="user-count">0</span>)</h3>
          <ul id="user-list" class="space-y-2">
            <li class="text-gray-500">暂无用户。</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 最近删除 -->
    <div class="bg-white p-6 rounded-xl shadow-lg">
      <h2 class="text-2xl font-semibold mb-4 text-gray-800">最近删除 (5天内)</h2>
      <ul id="deleted-todos-list" class="space-y-3">
        <p class="text-center text-gray-500 py-10">无已删除事项。</p>
      </ul>
    </div>

  </div>

  <script src="/script.js"></script>
</body>
</html>`,
  '/styles.css': () => `body { 
  font-family: 'Inter', sans-serif; 
  background-color: #f4f5f7; 
}

.completed label { 
  text-decoration: line-through; 
  color: #9ca3af; 
}

.todo-item { 
  display: flex; 
  align-items: center; 
  padding: 12px; 
  background: white; 
  border-radius: 8px; 
  box-shadow: 0 1px 2px rgba(0,0,0,0.05); 
}

.todo-item input[type="checkbox"] { 
  width: 18px; 
  height: 18px; 
  margin-right: 12px; 
  flex-shrink: 0; 
  cursor: pointer; 
}

.todo-item label { 
  flex-grow: 1; 
  font-size: 1.05em; 
}

.meta-info { 
  font-size: 0.8em; 
  color: #6b7280; 
}

.delete-btn, .delete-link-btn {
  background-color: #ef4444; 
  color: white; 
  border: none; 
  padding: 4px 10px; 
  border-radius: 6px; 
  font-weight: bold; 
  cursor: pointer; 
  transition: background-color 0.2s;
}

.delete-btn:hover, .delete-link-btn:hover { 
  background-color: #dc2626; 
}`,
  '/script.js': () => `async function toggleTodo(id, isChecked, ownerId) {
  try {
    const response = await fetch('/update_todo', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, completed: isChecked, ownerId }),
    });
    if (!response.ok) throw new Error('Update failed');
    window.location.reload();
  } catch (error) {
    console.error("Update failed:", error);
    alert('Update failed, please try again.');
  }
}

async function deleteTodo(id, ownerId) {
  if (!confirm('确定要删除用户 ' + ownerId + ' 的此事项吗？')) return;
  try {
    const response = await fetch('/delete_todo', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ownerId }),
    });
    if (!response.ok) throw new Error('Delete failed');
    window.location.reload();
  } catch (error) {
    console.error("Delete failed:", error);
    alert('Delete failed, please try again.');
  }
}

async function deleteUser(token) {
  if (!confirm('确定要删除此用户吗？其个人链接将失效。')) return;
  try {
    const response = await fetch('/delete_user', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) throw new Error('Delete user failed');
    window.location.reload();
  } catch (error) {
    console.error("Delete user failed:", error);
    alert('Delete user failed, please try again.');
  }
}`
};

// --- 主请求处理器 ---

async function handleRequest(request) {
  try {
    const url = new URL(request.url);
    const verificationFilePath = '/6ee0f9bfa3e3dd568497b8062fba8521.txt';
    const verificationContent = '12c799e1e1c52e9b3d20f6420f5e46a0589222ba';
    // 1. 优先级最高：处理域名验证文件
    // 必须检查完整的 url.pathname，而不是 pathSegment
    if (url.pathname === verificationFilePath) {
        return new Response(verificationContent, {
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            status: 200
        });
    }

  const pathname = url.pathname;
  const pathSegment = pathname.substring(1).split('/')[0].toLowerCase();
  
  // 处理静态资源请求
  if (request.method === 'GET' && STATIC_FILES[pathname]) {
    const content = STATIC_FILES[pathname]();
    let contentType = 'text/plain';
    
    if (pathname.endsWith('.html')) contentType = 'text/html;charset=UTF-8';
    if (pathname.endsWith('.css')) contentType = 'text/css';
    if (pathname.endsWith('.js')) contentType = 'application/javascript';
    
    // 如果是主页，使用动态渲染
    if (pathname === '/' || pathname === '/index.html') {
      const shareLinks = await loadShareLinks();
      const isRootView = pathSegment === '';
      
      if (isRootView || shareLinks[pathSegment]) {
        const allTodos = await getAllUsersTodos();
        let deletedTodos = await loadDeletedTodos();

        const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
        const recentDeletedTodos = deletedTodos.filter(todo => new Date(todo.deletedAt) > fiveDaysAgo);
        if (recentDeletedTodos.length < deletedTodos.length) {
          await saveDeletedTodos(recentDeletedTodos);
        }

        return new Response(renderMasterViewHtml(url, allTodos, recentDeletedTodos, shareLinks, isRootView), {
          headers: { 'Content-Type': 'text/html;charset=UTF-8' },
        });
      } else {
        return new Response('404 Not Found: User or page does not exist.', { status: 404 });
      }
    }
    
    return new Response(content, {
      headers: { 'Content-Type': contentType },
    });
  }
  
  if (request.method === 'POST' && pathSegment === 'add_todo') {
    return handleAddTodo(request, url);
  }
  if (request.method === 'PUT' && pathSegment === 'update_todo') {
    return handleUpdateTodo(request);
  }
  if (request.method === 'DELETE' && pathSegment === 'delete_todo') {
    return handleDeleteTodo(request);
  }
  if (request.method === 'POST' && pathSegment === 'add_user') {
    return handleCreateUser(request, url);
  }
  if (request.method === 'DELETE' && pathSegment === 'delete_user') {
    return handleDeleteUser(request);
  }

  if (request.method === 'GET') {
    const shareLinks = await loadShareLinks();
    const isRootView = pathSegment === '';
    
    if (isRootView || shareLinks[pathSegment]) {
      const allTodos = await getAllUsersTodos();
      let deletedTodos = await loadDeletedTodos();

      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const recentDeletedTodos = deletedTodos.filter(todo => new Date(todo.deletedAt) > fiveDaysAgo);
      if (recentDeletedTodos.length < deletedTodos.length) {
        await saveDeletedTodos(recentDeletedTodos);
      }

      return new Response(renderMasterViewHtml(url, allTodos, recentDeletedTodos, shareLinks, isRootView), {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      });
    } else {
      return new Response('404 Not Found: User or page does not exist.', { status: 404 });
    }
  }

  return new Response('Method Not Allowed', { status: 405 });
  } catch (error) {
    console.error('Error in handleRequest:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

// --- API 逻辑处理器 ---

async function handleAddTodo(request, url) {
  const referer = request.headers.get('Referer') || url.origin;
  const refererPath = new URL(referer).pathname.substring(1).split('/')[0].toLowerCase();
  
  const shareLinks = await loadShareLinks();
  let creatorId = 'admin';
  if (shareLinks[refererPath]) {
      creatorId = shareLinks[refererPath].username;
  }

  const formData = await request.formData();
  const text = formData.get('text');
  let ownerIds = formData.getAll('userIds');

  if (!text) {
    return new Response('Missing "text" in form data', { status: 400 });
  }
  
  if (ownerIds.length === 0) {
    ownerIds.push('public');
  }

  const newTodo = {
    id: crypto.randomUUID(),
    text: text,
    completed: false,
    createdAt: new Date().toISOString(),
    creatorId: creatorId,
  };

  for (const ownerId of ownerIds) {
    const kvKey = getKvKey(ownerId);
    const todos = await loadTodos(kvKey);
    todos.push(newTodo);
    await saveTodos(kvKey, todos);
  }

  return Response.redirect(referer, 303);
}

async function handleUpdateTodo(request) {
  const { id, completed, ownerId } = await request.json();
  if (!id || completed === undefined || !ownerId) {
    return new Response(JSON.stringify({ error: "Missing 'id', 'completed', or 'ownerId'" }), { status: 400 });
  }

  const referer = request.headers.get('Referer');
  let completerId = 'admin';
  if (referer) {
      const refererPath = new URL(referer).pathname.substring(1).split('/')[0].toLowerCase();
      const shareLinks = await loadShareLinks();
      if (shareLinks[refererPath]) {
          completerId = shareLinks[refererPath].username;
      }
  }

  const kvKey = getKvKey(ownerId);
  const todos = await loadTodos(kvKey);
  const todoIndex = todos.findIndex(t => t.id === id);

  if (todoIndex !== -1) {
    const isCompleted = Boolean(completed);
    todos[todoIndex].completed = isCompleted;
    if (isCompleted) {
      todos[todoIndex].completedAt = new Date().toISOString();
      todos[todoIndex].completedBy = completerId;
    } else {
      delete todos[todoIndex].completedAt;
      delete todos[todoIndex].completedBy;
    }
    await saveTodos(kvKey, todos);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } else {
    return new Response(JSON.stringify({ error: "Todo not found" }), { status: 404 });
  }
}

async function handleDeleteTodo(request) {
  const { id, ownerId } = await request.json();
  if (!id || !ownerId) {
    return new Response(JSON.stringify({ error: "Missing 'id' or 'ownerId'" }), { status: 400 });
  }

  const referer = request.headers.get('Referer');
  let deleterId = 'admin';
  if (referer) {
      const refererPath = new URL(referer).pathname.substring(1).split('/')[0].toLowerCase();
      const shareLinks = await loadShareLinks();
      if (shareLinks[refererPath]) {
          deleterId = shareLinks[refererPath].username;
      }
  }

  const kvKey = getKvKey(ownerId);
  let todos = await loadTodos(kvKey);
  const todoIndex = todos.findIndex(t => t.id === id);

  if (todoIndex !== -1) {
    const todoToDelete = todos[todoIndex];
    todos.splice(todoIndex, 1);
    await saveTodos(kvKey, todos);

    const deletedTodo = {
      ...todoToDelete,
      ownerId: ownerId,
      deletedAt: new Date().toISOString(),
      deletedBy: deleterId
    };

    const deletedTodos = await loadDeletedTodos();
    deletedTodos.push(deletedTodo);
    await saveDeletedTodos(deletedTodos);

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } else {
    return new Response(JSON.stringify({ error: "Todo not found" }), { status: 404 });
  }
}

async function handleCreateUser(request, url) {
    const formData = await request.formData();
    const username = formData.get('username')?.toLowerCase();
    if (!username) {
        return new Response('Username is required', { status: 400 });
    }

    const shareLinks = await loadShareLinks();
    const newToken = crypto.randomUUID().substring(0, 8);
    
    shareLinks[newToken] = {
        username: username,
        created_at: new Date().toISOString()
    };
    
    await saveShareLinks(shareLinks);
    return Response.redirect(url.origin, 303);
}

async function handleDeleteUser(request) {
    const { token } = await request.json();
    if (!token) {
        return new Response(JSON.stringify({ error: "Missing 'token'" }), { status: 400 });
    }

    const shareLinks = await loadShareLinks();
    if (shareLinks[token]) {
        delete shareLinks[token];
        await saveShareLinks(shareLinks);
        return new Response(JSON.stringify({ success: true }), { status: 200 });
    } else {
        return new Response(JSON.stringify({ error: "User token not found" }), { status: 404 });
    }
}


// --- HTML 模板和前端逻辑 ---

function renderMasterViewHtml(url, allTodos, deletedTodos, shareLinks, isRootView) {
  const origin = url.origin;

  let creatorId = 'admin';
  if (!isRootView) {
    const pathSegment = url.pathname.substring(1).split('/')[0].toLowerCase();
    creatorId = shareLinks[pathSegment]?.username || 'unknown';
  }

  const allListItems = allTodos.map(todo => {
    const ownerDisplayName = todo.ownerId === 'public' ? '' : getDisplayName(todo.ownerId);
    const ownerInfo = ownerDisplayName ? ` | 指派给: <strong>${ownerDisplayName}</strong>` : '';
    const creatorDisplayName = getDisplayName(todo.creatorId || 'unknown');
    const completionInfo = todo.completed ? ` | 由 <strong>${getDisplayName(todo.completedBy)}</strong> 在 ${formatDate(todo.completedAt)} 完成` : '';
    
    return `
    <li data-id="${todo.id}" data-owner="${todo.ownerId}" class="todo-item ${todo.completed ? 'completed' : ''}">
      <input type="checkbox" id="todo-${todo.id}" ${todo.completed ? 'checked' : ''} onchange="toggleTodo('${todo.id}', this.checked, '${todo.ownerId}')">
      <div class="flex-grow">
        <label for="todo-${todo.id}">${todo.text}</label>
        <div class="meta-info">由 <strong>${creatorDisplayName}</strong> 在 ${formatDate(todo.createdAt)} 创建${ownerInfo}${completionInfo}</div>
      </div>
      <button class="delete-btn" onclick="deleteTodo('${todo.id}', '${todo.ownerId}')">×</button>
    </li>
  `}).join('');

  const deletedListItems = deletedTodos.sort((a,b) => new Date(b.deletedAt) - new Date(a.deletedAt)).map(todo => {
      const ownerDisplayName = todo.ownerId === 'public' ? '' : getDisplayName(todo.ownerId);
      const ownerInfo = ownerDisplayName ? ` | 指派给: <strong>${ownerDisplayName}</strong>` : '';
      const creatorDisplayName = getDisplayName(todo.creatorId || 'unknown');
      const completionInfo = todo.completed ? ` | 由 <strong>${getDisplayName(todo.completedBy)}</strong> 在 ${formatDate(todo.completedAt)} 完成` : '';
      const deletionInfo = ` | 由 <strong>${getDisplayName(todo.deletedBy)}</strong> 在 ${formatDate(todo.deletedAt)} 删除`;

      return `
      <li class="todo-item opacity-60">
        <div class="flex-grow">
          <label class="${todo.completed ? 'line-through' : ''}">${todo.text}</label>
          <div class="meta-info">由 <strong>${creatorDisplayName}</strong> 在 ${formatDate(todo.createdAt)} 创建${ownerInfo}${completionInfo}${deletionInfo}</div>
        </div>
      </li>
      `;
  }).join('');

  const userOptions = Object.values(shareLinks).map(link => 
    `<label class="flex items-center space-x-2 font-normal">
        <input type="checkbox" name="userIds" value="${link.username}" class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50">
        <span>${getDisplayName(link.username)}</span>
    </label>`
  ).join('');

  let userManagementHtml = '';
  if (isRootView) {
    const linkItems = Object.entries(shareLinks).map(([token, data]) => `
      <li class="flex justify-between items-center py-2 border-b">
        <div>
          <p class="font-medium text-gray-800">${getDisplayName(data.username)}</p>
          <a href="/${token}" class="text-sm text-blue-600 hover:underline" target="_blank">${origin}/${token}</a>
        </div>
        <button class="ml-4 delete-link-btn" onclick="deleteUser('${token}')">删除用户</button>
      </li>
    `).join('');

    userManagementHtml = `
      <div class="bg-white p-6 rounded-xl shadow-lg">
        <h2 class="text-2xl font-semibold mb-4 text-gray-800">用户管理</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h3 class="text-lg font-semibold mb-2">新增用户</h3>
            <form action="/add_user" method="POST" class="flex space-x-2">
              <input type="text" name="username" placeholder="新用户名..." required class="flex-grow p-2 border rounded-lg">
              <button type="submit" class="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-lg">创建</button>
            </form>
          </div>
          <div>
            <h3 class="text-lg font-semibold mb-2">现有用户 (${Object.keys(shareLinks).length})</h3>
            <ul class="space-y-2">
              ${linkItems || '<li class="text-gray-500">暂无用户。</li>'}
            </ul>
          </div>
        </div>
      </div>`;
  }

  const clientScript = `
        async function toggleTodo(id, isChecked, ownerId) {
          try {
            const response = await fetch('/update_todo', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id, completed: isChecked, ownerId }),
            });
            if (!response.ok) throw new Error('Update failed');
            window.location.reload();
          } catch (error) {
            console.error("Update failed:", error);
            alert('Update failed, please try again.');
          }
        }

        async function deleteTodo(id, ownerId) {
          if (!confirm('确定要删除用户 ' + ownerId + ' 的此事项吗？')) return;
          try {
            const response = await fetch('/delete_todo', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id, ownerId }),
            });
            if (!response.ok) throw new Error('Delete failed');
            window.location.reload();
          } catch (error) {
            console.error("Delete failed:", error);
            alert('Delete failed, please try again.');
          }
        }

        async function deleteUser(token) {
          if (!confirm('确定要删除此用户吗？其个人链接将失效。')) return;
          try {
            const response = await fetch('/delete_user', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token }),
            });
            if (!response.ok) throw new Error('Delete user failed');
            window.location.reload();
          } catch (error) {
            console.error("Delete user failed:", error);
            alert('Delete user failed, please try again.');
          }
        }
  `;

  return `
    <!DOCTYPE html>
    <html lang="zh">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>全局待办事项清单</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        body { font-family: 'Inter', sans-serif; background-color: #f4f5f7; }
        .completed label { text-decoration: line-through; color: #9ca3af; }
        .todo-item { display: flex; align-items: center; padding: 12px; background: white; border-radius: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
        .todo-item input[type="checkbox"] { width: 18px; height: 18px; margin-right: 12px; flex-shrink: 0; cursor: pointer; }
        .todo-item label { flex-grow: 1; font-size: 1.05em; }
        .meta-info { font-size: 0.8em; color: #6b7280; }
        .delete-btn, .delete-link-btn {
            background-color: #ef4444; color: white; border: none; padding: 4px 10px; border-radius: 6px; font-weight: bold; cursor: pointer; transition: background-color 0.2s;
        }
        .delete-btn:hover, .delete-link-btn:hover { background-color: #dc2626; }
      </style>
    </head>
    <body class="p-4 md:p-8">
      <div class="container mx-auto max-w-4xl space-y-10">
        
        <h1 class="text-4xl font-bold text-center text-gray-900">全局待办事项清单</h1>

        <!-- 添加事项的表单 -->
        <div class="bg-white p-6 rounded-xl shadow-lg">
          <h2 class="text-2xl font-semibold mb-4 text-gray-800">添加新事项</h2>
          <form action="/add_todo" method="POST">
            <input type="hidden" name="creatorId" value="${creatorId}">
            <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
              <input type="text" name="text" placeholder="输入新的待办事项..." required class="md:col-span-3 p-3 border rounded-lg">
              
              <div class="md:col-span-2 p-3 border rounded-lg bg-gray-50">
                <h3 class="text-base font-semibold mb-2 text-gray-700">指派给 (可多选)</h3>
                <div class="space-y-2 max-h-24 overflow-y-auto">
                    <label class="flex items-center space-x-2 font-normal">
                        <input type="checkbox" name="userIds" value="public" class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50">
                        <span>Public (无指定用户)</span>
                    </label>
                    ${userOptions}
                </div>
              </div>
            </div>
            <button type="submit" class="mt-4 w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg">添加</button>
          </form>
        </div>

        <!-- 待办事项列表 -->
        <div class="bg-white p-6 rounded-xl shadow-lg">
          <h2 class="text-2xl font-semibold mb-4 text-gray-800">所有事项</h2>
          <ul id="all-todos-list" class="space-y-3">
            ${allListItems || '<p class="text-center text-gray-500 py-10">无任何待办事项。</p>'}
          </ul>
        </div>

        <!-- 用户管理区域 -->
        ${userManagementHtml}

        <!-- 最近删除 -->
        <div class="bg-white p-6 rounded-xl shadow-lg">
          <h2 class="text-2xl font-semibold mb-4 text-gray-800">最近删除 (5天内)</h2>
          <ul id="deleted-todos-list" class="space-y-3">
            ${deletedListItems || '<p class="text-center text-gray-500 py-10">无已删除事项。</p>'}
          </ul>
        </div>

      </div>

      <script>${clientScript}</script>
    </body>
    </html>
  `;
}
