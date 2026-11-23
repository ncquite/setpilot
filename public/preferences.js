const input = document.getElementById("setlists-directory");
const status = document.getElementById("preferences-status");
const save = document.getElementById("save-preferences");
const api = window.setpilotPreferences;
save.disabled = true;
try {
  input.value = await api.getDirectory();
  save.disabled = false;
} catch (err) {
  status.textContent = err.message;
}
document.getElementById("preferences-form").onsubmit = async (event) => {
  event.preventDefault();
  save.disabled = true;
  try {
    input.value = await api.saveDirectory(input.value);
    status.textContent = "Setlist folder saved.";
  } catch (err) {
    status.textContent = err.message;
  } finally {
    save.disabled = false;
  }
};
