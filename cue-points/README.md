# Cue points

This snippet is an example of algorithm that looks for mix points of an audio file.

## How it works

It finds automatically 4 cue points:

* **B**EGIN - When the audio starts.
* **S**TART - Mix point with previous audio file played.
* **N**EXT - Mix point with next audio file played.
* **E**ND - When the audio ends.

The algorithm starts looking for the START cue point based on a defined audio level peak or an audio level reached for a defined duration.

Next, it will compute the BEGIN cue point considering that it will be the end of an hypothetical fade in that starts before the START cue point. By default, the script will consider that the START cue point will be equals to the BEGIN cue point. This is equivalent to adjust the hypothetical fade in to 0.

After that, the audio file will be reversed (seriously when I discovered this trick, I was like… wow!) and it will look for the NEXT cue point as if it was the START cue point.

Finally, as for the BEGIN cue point, it will find the END cue point. By default, it will consider that the fade duration will last for 500ms.

Here is a simple preview of the position of the cue points.

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  ┋     ┋                          ┋     ┋  ┃
┃  ┋   ╭──────────────────────────────╮   ┋  ┃
┃  ┋  ╱  ┋                          ┋  ╲  ┋  ┃
┃  ┋ ╱   ┋                          ┋   ╲ ┋  ┃
┃  ┋╱    ┋                          ┋    ╲┋  ┃
┃  ┋     ┋                          ┋     ┋  ┃
┃ ╱┋     ┋                          ┋     ┋╲ ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
   B     S                          N     E
```

You will get more details about the implementation inside [the javascript code](app.js).

## Known bugs

* The cue points computing is not determinist. It is probably due to the way that the browser implements the script processor audio node. It does not change anything about the way the algorithm works theorically, but it can provide some different results when clicking several times on the "Compute" buttons.

## Demonstration

[Follow me](http://projects.c-mh.fr/radio-snippets/cue-points/)