# jinni

Jinni is an IRC bot for Joyent's channels on irc.freenode.net.  Jinni performs
the following functions.

* Reply with the URL for issues that people mention.
* Give the location of the SmartOS changelog when asked.

## Contributing

If you'd like to add/change something, fee free to open an issue or pull
request. Pull requests must pass `make check`.

## Requirements

The `irc` node module is built from source, so you'll need a compiler
(`build-essential`) and the `icu` package.  In order to run `make check` you'll
need [jsstyle](https://github.com/davepacheco/jsstyle) and
[jsl](https://github.com/davepacheco/javascriptlint) in your path.
