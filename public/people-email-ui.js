(() => {
  function emailGroup() { return document.getElementById('person-email-group'); }
  function teamGroup() { return document.getElementById('person-team-group'); }

  function ensurePersonFields() {
    const valueGroup = document.getElementById('input-modal-value')?.closest('.form-group');
    if (!valueGroup) return;

    if (!emailGroup()) {
      const eGroup = document.createElement('div');
      eGroup.id = 'person-email-group';
      eGroup.className = 'form-group';
      eGroup.style.marginTop = '14px';
      eGroup.innerHTML = '<label id="person-email-label" style="display:block;margin-bottom:8px;">Email ID:</label><input type="email" id="person-email-input" placeholder="name@company.in" autocomplete="email">';
      valueGroup.insertAdjacentElement('afterend', eGroup);
    }

    if (!teamGroup()) {
      const tGroup = document.createElement('div');
      tGroup.id = 'person-team-group';
      tGroup.className = 'form-group';
      tGroup.style.marginTop = '14px';
      tGroup.innerHTML = '<label id="person-team-label" style="display:block;margin-bottom:8px;">Location / Team:</label><select id="person-team-select" style="width:100%;box-sizing:border-box;background:#292e38;color:#e8edf5;border:1px solid #3f4655;border-radius:8px;padding:9px 12px;font:inherit;outline:none;"><option value="CBE">🏢 CBE Team (Coimbatore)</option><option value="BLR">🏙️ BLR Team (Bangalore)</option></select>';
      (emailGroup() || valueGroup).insertAdjacentElement('afterend', tGroup);
    }
  }

  const originalHandle = window.handleDropdownChange;
  window.handleDropdownChange = function(selectElem, type) {
    originalHandle.call(this, selectElem, type);
    ensurePersonFields();
    const eGroup = emailGroup();
    const tGroup = teamGroup();
    const isPerson = selectElem.value === '__ADD_NEW__' && type === 'name';

    if (eGroup) eGroup.style.display = isPerson ? 'block' : 'none';
    if (tGroup) tGroup.style.display = isPerson ? 'block' : 'none';

    if (isPerson) {
      document.getElementById('input-modal-title').textContent = '👤 Add New Person';
      const emailInput = document.getElementById('person-email-input');
      if (emailInput) {
        emailInput.value = '';
        emailInput.required = true;
      }
      const teamSelect = document.getElementById('person-team-select');
      if (teamSelect) teamSelect.value = 'CBE';

      const nameInput = document.getElementById('input-modal-value');
      if (nameInput) {
        nameInput.oninput = () => {
          const val = nameInput.value.trim().toLowerCase();
          if (val === 'manoj' || val === 'sharath' || val.includes('sriram')) {
            if (teamSelect) teamSelect.value = 'BLR';
          }
        };
      }
    }
  };

  const originalClose = window.closeInputModal;
  window.closeInputModal = function() {
    const eGroup = emailGroup();
    const tGroup = teamGroup();
    if (eGroup) eGroup.style.display = 'none';
    if (tGroup) tGroup.style.display = 'none';
    return originalClose.call(this);
  };

  const originalSubmit = window.submitInputModal;
  window.submitInputModal = async function() {
    if (window.activeInputType !== 'name') return originalSubmit.call(this);
    ensurePersonFields();
    const name = document.getElementById('input-modal-value').value.trim();
    const email = document.getElementById('person-email-input')?.value.trim();
    const team = document.getElementById('person-team-select')?.value || 'CBE';

    if (!name) return window.showToast('Please enter a valid name.', 'error');
    if (!email) return window.showToast('Please enter an email address.', 'error');

    try {
      const response = await fetch('/api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, team })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to save person');
      const currentElem = window.activeSelectElem;
      await window.loadOptions();
      if (currentElem) currentElem.value = name;
      window.showToast(`Added ${name} (${team} Team) with email address`, 'success');

      const eGroup = emailGroup();
      const tGroup = teamGroup();
      if (eGroup) eGroup.style.display = 'none';
      if (tGroup) tGroup.style.display = 'none';
      document.getElementById('input-modal').style.display = 'none';
    } catch (error) {
      window.showToast(error.message || 'Failed to add person', 'error');
    }
  };

  window.addEventListener('DOMContentLoaded', () => {
    ensurePersonFields();
    if (emailGroup()) emailGroup().style.display = 'none';
    if (teamGroup()) teamGroup().style.display = 'none';
  });
})();
