install: smf.xml node_modules
	true
	svccfg import sfm.xml

smf.xml: smf.json node_modules
	json -f $< -e "this.exec=\"${PWD}/jinni.js\"" | ./node_modules/smfgen/smfgen > $@

node_modules: package.json
	npm install

check: jinni.js
	jsstyle -t 4 -o indent=4 $<
	jsl --conf=jsl.node.conf $<

clean:
	rm -r smf.xml node_modules
