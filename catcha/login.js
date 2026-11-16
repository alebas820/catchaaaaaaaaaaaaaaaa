const form = document.getElementById("login-form");
const message = document.getElementById("login-message");
const submit = form.querySelector('button[type="submit"]');

form.addEventListener("submit", async event => {
  event.preventDefault();
  submit.disabled = true;
  message.textContent = "Verifica accesso…";
  message.className = "form-message";
  try {
    const response = await fetch("/api/login", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      credentials:"same-origin",
      body:JSON.stringify({
        username:document.getElementById("username").value,
        password:document.getElementById("password").value
      })
    });
    if (response.ok) {
      message.textContent = "Accesso autorizzato. Apertura di Catcha…";
      window.location.replace("/");
      return;
    }
    if (response.status === 401) {
      message.textContent = "Username o password non validi.";
    } else if (response.status === 429) {
      message.textContent = "Troppi tentativi. Attendi qualche minuto prima di riprovare.";
    } else if (response.status === 503) {
      message.textContent = "Accesso non ancora configurato dall'amministratore.";
    } else {
      message.textContent = `Accesso non riuscito (HTTP ${response.status}).`;
    }
    message.classList.add("error");
  } catch {
    message.textContent = "Impossibile raggiungere il server. Controlla la connessione e riprova.";
    message.classList.add("error");
  } finally {
    submit.disabled = false;
  }
});
