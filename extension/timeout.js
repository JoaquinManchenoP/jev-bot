// Bound protocol calls so one hung command cannot block the companion queue.
export async function withTimeout(promise, label, milliseconds = 6000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(label + ' timed out. Reload the Jev companion and try again.')), milliseconds);
    })]);
  } finally {clearTimeout(timer);}
}
