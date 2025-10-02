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
