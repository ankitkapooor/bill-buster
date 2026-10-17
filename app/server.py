"""Small stateless web service. Documents are processed in memory, never saved."""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from app.engine import BillError, REFERENCES, analyze, packet
from app.documents import SAMPLE, sample_pdf, extract_pdf, pdf_document

STATIC = Path(__file__).resolve().parents[1] / 'static'
MAX_UPLOAD = 2 * 1024 * 1024

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Do not log request bodies, uploaded filenames, query strings or extracted bill fields.
        sys.stderr.write(f'{self.command} {urlparse(self.path).path} {args[1] if len(args)>1 else ""}\n')

    def send(self, status, body, content_type='application/json; charset=utf-8', filename=None):
        if isinstance(body, (dict,list)):
            body=json.dumps(body,allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if filename:
            self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path=='/api/health':
            return self.send(200,dict(status='ok',mode='deterministic',storage='none'))
        if path=='/api/sample':
            return self.send(200,dict(bill=SAMPLE,method='Synthetic sample, loaded from a fixture. Checks run live after confirmation.'))
        if path=='/api/reference':
            return self.send(200,{k:REFERENCES[k] for k in ['hospital','quarter','start','end','price_date','codes','sources']})
        if path=='/sample-bill.pdf':
            return self.send(200,sample_pdf(),'application/pdf','bill-buster-synthetic-bill.pdf')
        files = {'/':('index.html','text/html; charset=utf-8'),'/app.js':('app.js','text/javascript; charset=utf-8'),'/styles.css':('styles.css','text/css; charset=utf-8')}
        if path in files:
            file,kind=files[path]
            return self.send(200,(STATIC/file).read_bytes(),kind)
        return self.send(404,dict(error='Page not found.'))

    def do_POST(self):
        try:
            path=urlparse(self.path).path
            # A same-origin browser request needs no credentials or cross-origin API access.
            origin=self.headers.get('Origin')
            if origin and urlparse(origin).netloc != self.headers.get('Host'):
                return self.send(403,dict(error='Use the app from its own website.'))
            try:
                size=int(self.headers.get('Content-Length','0'))
            except ValueError:
                raise BillError('Invalid upload length.')
            if size<=0 or size>MAX_UPLOAD:
                return self.send(413,dict(error='Choose a file smaller than 2 MB.'))
            body=self.rfile.read(size)
            if path=='/api/extract':
                return self.send(200,extract_pdf(body))
            if path not in ('/api/analyze','/api/packet.pdf'):
                return self.send(404,dict(error='Endpoint not found.'))
            raw=json.loads(body)
            result=analyze(raw.get('bill'))
            draft=packet(result)
            if path=='/api/analyze':
                return self.send(200,dict(result=result,packet=draft))
            # User edits are exported as user-written text and are never represented as verified.
            edited=raw.get('letter',draft['letter'])
            if not isinstance(edited,str) or len(edited)>50000:
                raise BillError('The letter is too long to export.')
            paragraphs=['User-editable inquiry. Changes to the verified template have not been automatically validated.'] if edited!=draft['letter'] else [draft['validation']]
            paragraphs+=edited.split('\n\n')+['Phone checklist']+[f'{i}. {text}' for i,text in enumerate(draft['checklist'],1)]
            return self.send(200,pdf_document('Your billing inquiry packet',paragraphs),'application/pdf','bill-buster-inquiry.pdf')
        except (BillError,json.JSONDecodeError,AttributeError) as error:
            self.send(400,dict(error=str(error) if isinstance(error,BillError) else 'The bill could not be read. Check your input and try again.'))
        except Exception:
            self.send(500,dict(error='The review could not finish. Your bill has not been saved. Please try again.'))

def main():
    port=int(os.environ.get('PORT','8000'))
    server=ThreadingHTTPServer(('0.0.0.0',port),Handler)
    server.daemon_threads=True
    server.timeout=30
    print(f'Bill Buster running at http://localhost:{port}',flush=True)
    server.serve_forever()

if __name__=='__main__':
    main()
