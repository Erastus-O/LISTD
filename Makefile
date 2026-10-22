# LISTD — common developer tasks. Needs Python 3.10+.
.PHONY: build build-platform build-website site serve test clean

build: build-platform build-website

# Website and products together in public/ (website at /, products at /app/)
site:
	python3 build.py

build-platform:
	cd platform && python3 build.py

build-website:
	cd website && python3 build.py

serve: site
	@echo "Website:  http://localhost:8000/"
	@echo "Products: http://localhost:8000/app/client.html, /app/pro.html, /app/admin.html"
	python3 -m http.server 8000 -d public

# Set JSPDF_PATH to a local jspdf.umd.min.js (npm pack jspdf@2.5.1) to include the PDF test.
test: site
	cd platform && for t in check_portals e2e_site_links e2e_auth e2e_settings e2e_cross_portal e2e_invite e2e_staff e2e_levels e2e_invoicing e2e_full_lifecycle; do echo "== $$t"; python3 tests/$$t.py | tail -2 || exit 1; done
	@if [ -n "$$JSPDF_PATH" ]; then cd platform && echo "== e2e_inspection_ai" && python3 tests/e2e_inspection_ai.py | tail -2; else echo "(skipped e2e_inspection_ai: set JSPDF_PATH)"; fi

clean:
	rm -rf platform/tests/out public
