const form = document.getElementById("admin-user-form");
const submit = document.getElementById("create-user-button");
const message = document.getElementById("admin-message");
const passwordInput = document.getElementById("new-password");
const passwordHint = document.getElementById("password-hint");

async function requestJson(url, options = {}) {
  const response = await fetch(url,{
    credentials:"same-origin",
    cache:"no-store",
    ...options
  });
  if (response.redirected) {
    window.location.replace("/login");
    throw new Error("Sessione terminata. Accedi di nuovo.");
  }
  const payload = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : {};
  if (!response.ok) throw new Error(payload.error || `Richiesta non riuscita (HTTP ${response.status}).`);
  return payload;
}

function showMessage(element,text,isError = false) {
  element.textContent = text;
  element.classList.toggle("error",isError);
}

function renderUsers(users) {
  const list = document.getElementById("user-list");
  list.replaceChildren();
  document.getElementById("user-count").textContent = String(users.length);
  if (!users.length) {
    showMessage(document.getElementById("list-message"),"Non ci sono ancora utenti configurati.");
    return;
  }
  showMessage(document.getElementById("list-message"),"");
  for (const user of users) {
    const item = document.createElement("li");
    item.className = "user-row";
    const identity = document.createElement("strong");
    identity.textContent = user.username;
    const detail = document.createElement("span");
    detail.className = "user-source";
    detail.textContent = user.source === "environment" ? "Variabile d'ambiente" : "Creato dall'amministratore";
    item.append(identity,detail);
    if (user.createdAt) {
      const date = document.createElement("time");
      date.dateTime = user.createdAt;
      date.textContent = new Date(user.createdAt).toLocaleDateString("it-IT");
      item.append(date);
    }
    if (user.source === "admin") {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-user-button";
      deleteButton.textContent = "Elimina";
      deleteButton.setAttribute("aria-label",`Elimina l'account ${user.username}`);
      deleteButton.addEventListener("click",() => deleteUser(user,deleteButton));
      item.append(deleteButton);
    }
    list.append(item);
  }
}

async function deleteUser(user,button) {
  const confirmed = window.confirm(`Eliminare l'account "${user.username}" e cancellare definitivamente la sua lista e i dati salvati?`);
  if (!confirmed) return;
  button.disabled = true;
  showMessage(message,`Eliminazione dell'account ${user.username}…`);
  try {
    const result = await requestJson("/api/admin/users",{
      method:"DELETE",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username:user.username})
    });
    showMessage(message,result.dataDeleted === false
      ? `Account ${user.username} eliminato, ma alcuni file dati non sono stati rimossi. Controlla i log del server.`
      : `Account ${user.username} e relativi dati eliminati.`);
    try {
      await loadUsers();
    } catch (error) {
      showMessage(document.getElementById("list-message"),error.message || "Impossibile aggiornare la lista utenti.",true);
    }
  } catch (error) {
    showMessage(message,error.message || "Impossibile eliminare l'account.",true);
  } finally {
    button.disabled = false;
  }
}

async function loadUsers() {
  const result = await requestJson("/api/admin/users");
  if (!Array.isArray(result.users) || !Number.isInteger(result.minimumPasswordLength)) {
    throw new Error("Risposta del server non valida.");
  }
  passwordInput.minLength = result.minimumPasswordLength;
  passwordHint.textContent = `Minimo ${result.minimumPasswordLength} caratteri. Scegli una password robusta e comunicala all'utente attraverso un canale sicuro. La password non sarà mostrata di nuovo.`;
  renderUsers(result.users);
}

form.addEventListener("submit",async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  submit.disabled = true;
  showMessage(message,"Creazione account…");
  try {
    const username = document.getElementById("new-username").value.trim();
    const password = passwordInput.value;
    await requestJson("/api/admin/users",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username,password})
    });
    form.reset();
    showMessage(message,`Account ${username} creato. Comunica le credenziali in modo sicuro.`);
  } catch (error) {
    showMessage(message,error.message || "Impossibile creare l'account.",true);
  } finally {
    submit.disabled = false;
  }
  try {
    await loadUsers();
  } catch (error) {
    showMessage(document.getElementById("list-message"),error.message || "Account creato, ma impossibile aggiornare la lista.",true);
  }
});

async function initializeAdminPage() {
  try {
    const account = await requestJson("/api/session");
    if (account.isAdmin !== true) {
      window.location.replace("/");
      return;
    }
    await loadUsers();
  } catch (error) {
    showMessage(document.getElementById("list-message"),error.message || "Impossibile caricare gli utenti.",true);
  }
}

initializeAdminPage();
