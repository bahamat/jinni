# jinni

Jinni is an IRC bot for Joyent's channels on irc.freenode.net.  Jinni performs
the following functions.

* Reply with the URL for issues that people mention.
* Give the location of the SmartOS changelog when asked.

# NO SUPPORT!!

Jinni is a side project that I get to work on, sometimes after midnight. It's
not an official Joyent project or sanctioned in any way. It will receive
minimal features as I have time and whim. The only reason it exists is because
I got tired of digging up the bugview URL on my own.

## Contributing

If you'd like to add/change something, feel free to open an issue or pull
request.  I won't go so far as to say I'll accept any, but feel free to ask.

Pull requests must pass `make check` before even being considered.

## Testing

Edit `config.json`, give your fork a new name and some different channels to
join for testing. We absolutely don't want our IRC channels overrun with bots.

## Requirements

The `irc` node module is built from source, so you'll need a compiler
(`build-essential`) and the `icu` package.  In order to run `make check` you'll
need [jsstyle](https://github.com/davepacheco/jsstyle) and
[jsl](https://github.com/davepacheco/javascriptlint) in your path.
