.PHONY: all
all: node_modules smf.xml

install: smf.xml node_modules
	svccfg import smf.xml

smf.xml: smf.json node_modules
	json -f $< -e "this.start.exec=\"${PWD}/jinni.js\"" | ./node_modules/smfgen/smfgen > $@

node_modules: package.json
	npm install --progress=false
	@touch node_modules

check: jinni.js
	jsstyle -t 4 -o indent=4 $<
	jsl --conf=jsl.node.conf $<

clean:
	rm -r smf.xml node_modules
