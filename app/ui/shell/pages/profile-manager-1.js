
    let profiles = [];
    let activeProfile = null;
    let editingUin = null;
    let switchToUin = null;

    // 加载账号列表
    async function loadProfiles() {
      try {
        const response = await fetch('/api/profiles');
        const data = await response.json();
        
        if (data.success) {
          profiles = data.profiles;
          activeProfile = data.activeProfile;
          renderProfiles();
          updateActiveBadge();
        } else {
          showToast('加载失败: ' + data.error, 'error');
        }
      } catch (error) {
        showToast('加载失败: ' + error.message, 'error');
      }
    }

    // 渲染账号卡片
    function renderProfiles() {
      const grid = document.getElementById('profileGrid');
      grid.innerHTML = '';

      profiles.forEach(profile => {
        const isActive = profile.uin === activeProfile;
        const card = document.createElement('div');
        card.className = `profile-card ${isActive ? 'active' : ''} ${!profile.enabled ? 'disabled' : ''}`;
        
        const roleIcon = profile.role === 'bot' ? '🤖' : profile.role === 'master' ? '👤' : '👥';
        
        card.innerHTML = `
          <div class="profile-header">
            <div class="profile-icon">${roleIcon}</div>
            <div class="profile-info">
              <div class="profile-title">${profile.label}</div>
              <div class="profile-subtitle">${profile.uin} · ${profile.role}</div>
            </div>
          </div>
          <div class="profile-details">
            <div class="detail-row">
              <span class="detail-label">数据目录</span>
              <span class="detail-value">${profile.dataDir}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">控制台端口</span>
              <span class="detail-value">${profile.port}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">状态</span>
              <span class="detail-value">${profile.enabled ? '✓ 已启用' : '✗ 已禁用'}</span>
            </div>
          </div>
          <div class="profile-actions">
            ${!isActive ? `<button class="btn btn-success btn-sm" data-profile-action="switch" data-profile-uin="${profile.uin}">切换到此账号</button>` : ''}
            <button class="btn btn-warning btn-sm" data-profile-action="edit" data-profile-uin="${profile.uin}">编辑</button>
            ${!isActive ? `<button class="btn btn-danger btn-sm" data-profile-action="delete" data-profile-uin="${profile.uin}">删除</button>` : ''}
          </div>
        `;
        
        grid.appendChild(card);
      });
    }

    // 更新活跃账号徽章
    function updateActiveBadge() {
      const badge = document.getElementById('activeBadge');
      const active = profiles.find(p => p.uin === activeProfile);
      badge.textContent = `当前: ${active ? active.label : '未知'}`;
    }

    // 显示新增模态框
    function showAddModal() {
      editingUin = null;
      document.getElementById('modalTitle').textContent = '新增账号';
      document.getElementById('uin').value = '';
      document.getElementById('uin').disabled = false;
      document.getElementById('label').value = '';
      document.getElementById('role').value = 'bot';
      document.getElementById('dataDir').value = `data-${profiles.length}`;
      document.getElementById('port').value = 3210 + profiles.length * 100;
      document.getElementById('profileModal').classList.add('show');
    }

    // 编辑账号
    function editProfile(uin) {
      const profile = profiles.find(p => p.uin === uin);
      if (!profile) return;

      editingUin = uin;
      document.getElementById('modalTitle').textContent = '编辑账号';
      document.getElementById('uin').value = uin;
      document.getElementById('uin').disabled = true;
      document.getElementById('label').value = profile.label;
      document.getElementById('role').value = profile.role;
      document.getElementById('dataDir').value = profile.dataDir;
      document.getElementById('port').value = profile.port;
      document.getElementById('profileModal').classList.add('show');
    }

    // 隐藏模态框
    function hideModal() {
      document.getElementById('profileModal').classList.remove('show');
    }

    // 保存账号
    async function saveProfile() {
      const uin = document.getElementById('uin').value.trim();
      const label = document.getElementById('label').value.trim();
      const role = document.getElementById('role').value;
      const dataDir = document.getElementById('dataDir').value.trim();
      const port = parseInt(document.getElementById('port').value);

      if (!uin || !label) {
        showToast('请填写 QQ号 和 标签', 'error');
        return;
      }

      try {
        let response;
        if (editingUin) {
          // 更新
          response = await fetch(`/api/profiles/${editingUin}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label, role })
          });
        } else {
          // 新增
          response = await fetch('/api/profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uin, label, role, dataDir, port })
          });
        }

        const data = await response.json();
        
        if (data.success) {
          showToast(data.message, 'success');
          hideModal();
          loadProfiles();
        } else {
          showToast('保存失败: ' + data.error, 'error');
        }
      } catch (error) {
        showToast('保存失败: ' + error.message, 'error');
      }
    }

    // 显示切换确认
    function showSwitchModal(uin) {
      switchToUin = uin;
      const profile = profiles.find(p => p.uin === uin);
      document.getElementById('switchMessage').textContent = 
        `确定要切换到「${profile.label}」吗？`;
      document.getElementById('switchModal').classList.add('show');
    }

    // 隐藏切换模态框
    function hideSwitchModal() {
      document.getElementById('switchModal').classList.remove('show');
    }

    // 确认切换
    async function confirmSwitch() {
      if (!switchToUin) return;

      try {
        const response = await fetch('/api/profiles/switch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uin: switchToUin })
        });

        const data = await response.json();
        
        if (data.success) {
          showToast(data.message + '，请刷新页面', 'success');
          hideSwitchModal();
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        } else {
          showToast('切换失败: ' + data.error, 'error');
        }
      } catch (error) {
        showToast('切换失败: ' + error.message, 'error');
      }
    }

    // 删除账号
    async function deleteProfile(uin) {
      if (!confirm('确定要删除此账号吗？数据目录不会被删除。')) return;

      try {
        const response = await fetch(`/api/profiles/${uin}`, {
          method: 'DELETE'
        });

        const data = await response.json();
        
        if (data.success) {
          showToast(data.message, 'success');
          loadProfiles();
        } else {
          showToast('删除失败: ' + data.error, 'error');
        }
      } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
      }
    }

    // 显示 Toast
    function showToast(message, type = 'success') {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = `toast ${type}`;
      toast.style.display = 'block';
      
      setTimeout(() => {
        toast.style.display = 'none';
      }, 3000);
    }

    // 页面加载时初始化
    document.addEventListener('DOMContentLoaded', () => {
      loadProfiles();
    });
  // CSP-safe button delegation, replacing inline onclick attributes.
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-profile-action]');if(!button)return;
 const actions={add:showAddModal,cancel:hideModal,save:saveProfile,'cancel-switch':hideSwitchModal,'confirm-switch':confirmSwitch,switch:showSwitchModal,edit:editProfile,delete:deleteProfile};
 actions[button.dataset.profileAction]?.(button.dataset.profileUin);
});
