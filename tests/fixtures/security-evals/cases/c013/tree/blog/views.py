from django.http import JsonResponse

from .models import Article


def article_list(request):
    rows = Article.objects.filter(**request.GET.dict()).values("id", "title")[:50]
    return JsonResponse(list(rows), safe=False)
